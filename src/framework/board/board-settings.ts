import { Application, Color, ThemeManager } from '../../runtime/index.js';
import { SolidColorBrush } from '../../visual-engine/index.js';
import { ApplicationSettings } from '../shell/services/application-settings-service.js';
import { SettingDefinition, SettingKind, ObservableCollection } from '@pragmatic-tech-ai/todl-runtime';
import { Setting } from '../shell/settings/setting.js';

// Stable keys for every tunable Board constant. A fixed set of named string
// values → an enum (per the no-string-literal-unions rule). Internal only:
// authors never write these in markup — the helper self-publishes its
// definitions to ApplicationSettings — so no symbol-table registration is
// needed. Values are namespaced by concern (shape / connector / chrome) and
// are the persistence + lookup keys.
export enum BoardSettingKey
{
    ShapeDefaultSize            = 'board.shape.defaultSize',
    ShapeLabelMargin            = 'board.shape.labelMargin',
    ShapeStrokeWidth            = 'board.shape.strokeWidth',
    ShapeMinResize              = 'board.shape.minResize',
    ShapeDefaultFill            = 'board.shape.defaultFill',
    ShapeDefaultStroke          = 'board.shape.defaultStroke',
    ShapeLabelInk               = 'board.shape.labelInk',
    ContainerDefaultFill        = 'board.container.defaultFill',
    TextDefaultFontSize         = 'board.text.defaultFontSize',
    TextNodeFill                = 'board.text.nodeFill',
    TextNodeStroke              = 'board.text.nodeStroke',

    ConnectorStrokeWidth        = 'board.connector.strokeWidth',
    ConnectorDefaultStroke      = 'board.connector.defaultStroke',
    ConnectorHitWidth           = 'board.connector.hitWidth',
    ConnectorOrthogonalStub     = 'board.connector.orthogonalStub',
    ConnectorLaneGap            = 'board.connector.laneGap',
    ConnectorBezierMinOffset    = 'board.connector.bezierMinOffset',
    ConnectorSegmentJogStub     = 'board.connector.segmentJogStub',
    ConnectorJogMargin          = 'board.connector.jogMargin',
    ConnectorSidePortsOptimizer = 'board.connector.sidePortsOptimizer',

    ChromeEndpointHandleSize    = 'board.chrome.endpointHandleSize',
    ChromeWaypointHandleSize    = 'board.chrome.waypointHandleSize',
    ChromeSegmentHandleSize     = 'board.chrome.segmentHandleSize',
    ChromePortMarkerSize        = 'board.chrome.portMarkerSize',
    ChromeSideBarThickness      = 'board.chrome.sideBarThickness',
    ChromeFigureProximity       = 'board.chrome.figureProximity',
    ChromeHoverHaloMinThickness = 'board.chrome.hoverHaloMinThickness',
    ChromeHoverHaloOpacity      = 'board.chrome.hoverHaloOpacity',
    ChromeTextHandleSize        = 'board.chrome.textHandleSize',
    ChromeTextRotateGap         = 'board.chrome.textRotateGap',
    ChromeTextStemWidth         = 'board.chrome.textStemWidth',
    ChromeGuideThickness        = 'board.chrome.guideThickness',
    ChromePersistentGuideThickness = 'board.chrome.persistentGuideThickness',
    ChromeGuideGrabTolerance       = 'board.chrome.guideGrabTolerance',
    ChromeGuideCreateMargin        = 'board.chrome.guideCreateMargin',
    ChromePersistentGuideColor     = 'board.chrome.persistentGuideColor',
    ChromePersistentGuideSelectedColor = 'board.chrome.persistentGuideSelectedColor',
    ChromePersistentGuidePreviewColor  = 'board.chrome.persistentGuidePreviewColor',
    ChromeHandleFill               = 'board.chrome.handleFill',
    ChromeConnectorEndpoint        = 'board.chrome.connectorEndpoint',
    ChromeConnectorHandle          = 'board.chrome.connectorHandle',
    ChromeConnectorSegment         = 'board.chrome.connectorSegment',
    ChromeNeutralInk               = 'board.chrome.neutralInk',
    ChromeLayoutPreviewBackdrop    = 'board.chrome.layoutPreviewBackdrop',
    ChromeLayoutPreviewNodeFill    = 'board.chrome.layoutPreviewNodeFill',
    ChromeLayoutPreviewStroke      = 'board.chrome.layoutPreviewStroke',

    DefaultIconWidth            = 'board.DefaultIconWidth',
    DefaultIconHeight           = 'board.DefaultIconHeight',

    ToolboxTileSize             = 'board.toolbox.tileSize',
    ToolboxPreviewFill          = 'board.toolbox.previewFill',

    RulerThickness              = 'board.ruler.thickness',
    RulerTickMinSpacing         = 'board.ruler.tickMinSpacing',
    RulerFill                   = 'board.ruler.fill',
    RulerTickColor              = 'board.ruler.tickColor',
    RulerHoverFill              = 'board.ruler.hoverFill',
}

// Which side-port crossing optimizer the board runs (Board · Connectors →
// "Side ports optimizer"). Stored/displayed verbatim — the settings pane renders
// a Choice as a ComboBox of these strings — so the member values double as the
// picker labels.
export enum SidePortsOptimizer
{
    // Fast heuristic (default): O(k log k) barycenter order + a hill-climb capped
    // to small sides. Cheap even on a 150+ connector hub.
    Optimized  = 'Optimized',
    // The exhaustive pre-optimization algorithm: a full, ungated O(k⁴) hill-climb
    // that minimises crossings hardest. Costly — can hang for minutes on a large
    // hub — and still cannot guarantee zero crossings on a non-planar graph.
    BruteForce = 'BruteForce',
}

// One catalogue row: the schema for a tunable constant. The `default` is the
// compiled-in constant value — the fallback the helper returns when no
// ApplicationSettings is reachable (tests, non-shell hosts) or the key is
// unset. `min`/`max` bound the Number editor in a settings pane.
interface BoardSettingSpec
{
    readonly key:         BoardSettingKey;
    readonly label:       string;
    readonly description: string;
    readonly category:    string;
    readonly default:     number;
    readonly min:         number;
    readonly max:         number;
}

const CAT_ICONS      = 'Board · Icons';
const CAT_SHAPES     = 'Board · Shapes';
const CAT_CONNECTORS = 'Board · Connectors';
const CAT_CHROME     = 'Board · Editing chrome';
const CAT_TOOLBOX    = 'Board · Toolbox';
const CAT_RULERS     = 'Board · Rulers';

// The single source of truth for every tunable Board constant. Each row's
// `default` is the historical hard-coded value; the board reads through the
// helper so a user override in ApplicationSettings takes over live.
const SPECS: readonly BoardSettingSpec[] =
[
    { key: BoardSettingKey.DefaultIconWidth, label: 'Default icon width',
      description: 'Default width of an icon node, in pixels.',
      category: CAT_ICONS, default: 80, min: 8, max: 400 },
    { key: BoardSettingKey.DefaultIconHeight, label: 'Default icon height',
      description: 'Default height of an icon node, in pixels.',
      category: CAT_ICONS, default: 80, min: 8, max: 400 },

    { key: BoardSettingKey.ShapeDefaultSize, label: 'Default shape size',
      description: 'Width & height of a newly-placed shape, in pixels.',
      category: CAT_SHAPES, default: 80, min: 8, max: 400 },
    { key: BoardSettingKey.ShapeLabelMargin, label: 'Shape label margin',
      description: 'Slack around a label when a shape grows to fit its text.',
      category: CAT_SHAPES, default: 8, min: 0, max: 64 },
    { key: BoardSettingKey.ShapeStrokeWidth, label: 'Shape stroke width',
      description: 'Outline thickness of a newly-placed shape, in pixels.',
      category: CAT_SHAPES, default: 1.5, min: 0, max: 16 },
    { key: BoardSettingKey.ShapeMinResize, label: 'Minimum shape size',
      description: 'Smallest width or height a shape can be resized to.',
      category: CAT_SHAPES, default: 8, min: 1, max: 64 },
    { key: BoardSettingKey.TextDefaultFontSize, label: 'Default label font size',
      description: 'Font size used for a new shape label, in points.',
      category: CAT_SHAPES, default: 12, min: 4, max: 96 },

    { key: BoardSettingKey.ConnectorStrokeWidth, label: 'Connector stroke width',
      description: 'Line thickness of a newly-drawn connector, in pixels.',
      category: CAT_CONNECTORS, default: 1.5, min: 0, max: 16 },
    { key: BoardSettingKey.ConnectorHitWidth, label: 'Connector hit width',
      description: 'Width of the invisible click/hover band around a connector.',
      category: CAT_CONNECTORS, default: 14, min: 2, max: 48 },
    { key: BoardSettingKey.ConnectorOrthogonalStub, label: 'Orthogonal stub length',
      description: 'How far an orthogonal route extends straight out of a port.',
      category: CAT_CONNECTORS, default: 20, min: 0, max: 120 },
    { key: BoardSettingKey.ConnectorLaneGap, label: 'Connector lane gap',
      description: 'Lateral spacing between connectors sharing a side.',
      category: CAT_CONNECTORS, default: 10, min: 0, max: 60 },
    { key: BoardSettingKey.ConnectorBezierMinOffset, label: 'Bezier minimum offset',
      description: 'Minimum control-point pull for a curved connector.',
      category: CAT_CONNECTORS, default: 20, min: 0, max: 120 },
    { key: BoardSettingKey.ConnectorSegmentJogStub, label: 'Segment jog stub',
      description: 'Jog offset from a pinned port when dragging a segment.',
      category: CAT_CONNECTORS, default: 20, min: 0, max: 120 },
    { key: BoardSettingKey.ConnectorJogMargin, label: 'Segment jog margin',
      description: 'Extra margin past the router stub for a jog anchor.',
      category: CAT_CONNECTORS, default: 6, min: 0, max: 60 },

    { key: BoardSettingKey.ChromeEndpointHandleSize, label: 'Endpoint handle size',
      description: 'Size of a connector endpoint drag dot, in pixels.',
      category: CAT_CHROME, default: 11, min: 4, max: 32 },
    { key: BoardSettingKey.ChromeWaypointHandleSize, label: 'Waypoint handle size',
      description: 'Size of a connector waypoint (corner) drag dot, in pixels.',
      category: CAT_CHROME, default: 9, min: 4, max: 32 },
    { key: BoardSettingKey.ChromeSegmentHandleSize, label: 'Segment handle size',
      description: 'Size of a mid-segment drag pad, in pixels.',
      category: CAT_CHROME, default: 9, min: 4, max: 32 },
    { key: BoardSettingKey.ChromePortMarkerSize, label: 'Port marker size',
      description: 'Size of a port-slot indicator on a hovered shape, in pixels.',
      category: CAT_CHROME, default: 7, min: 3, max: 24 },
    { key: BoardSettingKey.ChromeSideBarThickness, label: 'Side-bar thickness',
      description: 'Thickness of a hovered shape’s side-attach bars, in pixels.',
      category: CAT_CHROME, default: 3, min: 1, max: 16 },
    { key: BoardSettingKey.ChromeFigureProximity, label: 'Shape proximity tolerance',
      description: 'Cursor distance at which a shape’s attach chrome appears.',
      category: CAT_CHROME, default: 8, min: 0, max: 48 },
    { key: BoardSettingKey.ChromeHoverHaloMinThickness, label: 'Hover halo min thickness',
      description: 'Minimum stroke width of the connector hover halo, in pixels.',
      category: CAT_CHROME, default: 5, min: 1, max: 24 },
    { key: BoardSettingKey.ChromeHoverHaloOpacity, label: 'Hover halo opacity',
      description: 'Opacity of the connector hover halo (0–1).',
      category: CAT_CHROME, default: 0.45, min: 0, max: 1 },
    { key: BoardSettingKey.ChromeTextHandleSize, label: 'Text handle size',
      description: 'Size of a text-block move/rotate grip, in pixels.',
      category: CAT_CHROME, default: 9, min: 4, max: 32 },
    { key: BoardSettingKey.ChromeTextRotateGap, label: 'Text rotate-grip gap',
      description: 'Distance from a text block’s top edge to its rotate grip.',
      category: CAT_CHROME, default: 18, min: 0, max: 64 },
    { key: BoardSettingKey.ChromeTextStemWidth, label: 'Text rotate-stem width',
      description: 'Line width of a text block’s rotate stem, in pixels.',
      category: CAT_CHROME, default: 1, min: 1, max: 8 },
    { key: BoardSettingKey.ChromeGuideThickness, label: 'Alignment guide thickness',
      description: 'Line thickness of a snap alignment guide, in pixels.',
      category: CAT_CHROME, default: 1, min: 1, max: 8 },
    { key: BoardSettingKey.ChromePersistentGuideThickness, label: 'Persistent guide thickness',
      description: 'Line thickness of a user-placed ruler guide, in pixels.',
      category: CAT_CHROME, default: 1, min: 1, max: 8 },
    { key: BoardSettingKey.ChromeGuideGrabTolerance, label: 'Guide grab tolerance',
      description: 'Cursor distance at which a ruler guide can be grabbed/selected, in pixels.',
      category: CAT_CHROME, default: 6, min: 1, max: 24 },
    { key: BoardSettingKey.ChromeGuideCreateMargin, label: 'Guide create margin',
      description: 'Canvas band next to a ruler where a drag pulls out a new guide, in pixels.',
      category: CAT_CHROME, default: 14, min: 0, max: 48 },

    { key: BoardSettingKey.ToolboxTileSize, label: 'Toolbox tile size',
      description: 'Width & height of a shape preview tile in the toolbox, in pixels.',
      category: CAT_TOOLBOX, default: 48, min: 16, max: 128 },

    { key: BoardSettingKey.RulerThickness, label: 'Ruler thickness',
      description: 'Width/height of the ruler strips along the viewport edges, in pixels.',
      category: CAT_RULERS, default: 20, min: 12, max: 48 },
    { key: BoardSettingKey.RulerTickMinSpacing, label: 'Ruler tick minimum spacing',
      description: 'Smallest on-screen gap between labelled ruler ticks, in pixels.',
      category: CAT_RULERS, default: 60, min: 24, max: 200 },
];

const DEFAULTS: ReadonlyMap<BoardSettingKey, number> =
    new Map(SPECS.map(s => [s.key, s.default]));

// The colour-valued sibling of BoardSettingSpec. A Color setting carries a
// live SolidColorBrush (the service persists it as hex and restores the brush),
// so it needs no numeric bounds — just a brush `default`.
interface BoardColorSettingSpec
{
    readonly key:         BoardSettingKey;
    readonly label:       string;
    readonly description: string;
    readonly category:    string;
    readonly default:     SolidColorBrush;
}

const COLOR_SPECS: readonly BoardColorSettingSpec[] =
[
    { key: BoardSettingKey.ShapeDefaultFill, label: 'Default shape fill',
      description: 'Fill brush of a freshly-placed shape. Reads on the surface in both schemes.',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#bfdbfe')) },
    { key: BoardSettingKey.ShapeDefaultStroke, label: 'Default shape stroke',
      description: 'Stroke brush of a freshly-placed shape (width comes from Shape stroke width).',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#1976d2')) },
    { key: BoardSettingKey.ToolboxPreviewFill, label: 'Toolbox preview fill',
      description: 'Fill colour of a shape preview tile in the toolbox.',
      category: CAT_TOOLBOX, default: new SolidColorBrush(Color.FromHex('#1976d2')) },
    { key: BoardSettingKey.ChromePersistentGuideColor, label: 'Persistent guide colour',
      description: 'Colour of a user-placed ruler guide line.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#e5484d')) },
    { key: BoardSettingKey.ChromePersistentGuideSelectedColor, label: 'Selected guide colour',
      description: 'Colour of the currently-selected ruler guide line.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#f59e0b')) },
    { key: BoardSettingKey.ChromePersistentGuidePreviewColor, label: 'Guide preview colour',
      description: 'Colour of the faint preview line shown while hovering a guide drag-out zone.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#e5484d')) },
    { key: BoardSettingKey.RulerFill, label: 'Ruler fill',
      description: 'Background fill of the ruler strips. Defaults to the theme Surface; override to pin a colour.',
      category: CAT_RULERS, default: new SolidColorBrush(Color.FromHex('#f3f4f6')) },
    { key: BoardSettingKey.RulerTickColor, label: 'Ruler tick colour',
      description: 'Colour of ruler tick marks and labels. Defaults to the theme OnSurfaceVariant; override to pin a colour.',
      category: CAT_RULERS, default: new SolidColorBrush(Color.FromHex('#6b7280')) },
    { key: BoardSettingKey.RulerHoverFill, label: 'Ruler hover fill',
      description: 'Accent wash painted over a ruler strip while the pointer is over it. Defaults to a theme Primary wash; override to pin a colour.',
      category: CAT_RULERS, default: new SolidColorBrush(Color.FromHex('#dbeafe')) },

    { key: BoardSettingKey.ShapeLabelInk, label: 'Shape label ink',
      description: 'Default text colour of a shape label. Defaults to the theme OnSurface; override to pin a colour.',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#000000')) },
    { key: BoardSettingKey.TextNodeFill, label: 'Text-node fill',
      description: 'Fill of a text box node (transparent by default).',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#00000000')) },
    { key: BoardSettingKey.TextNodeStroke, label: 'Text-node stroke',
      description: 'Outline colour of a text box node.',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#94a3b8')) },

    { key: BoardSettingKey.ContainerDefaultFill, label: 'Container fill',
      description: 'Faint brand wash of a content (VM-backed) container box, so it reads as a box that holds children. Defaults to a theme Primary wash; override to pin a colour. Its border reuses the shape default stroke.',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#3b82f61c')) },
    { key: BoardSettingKey.ConnectorDefaultStroke, label: 'Default connector stroke',
      description: 'Line colour of a freshly-drawn connector. Defaults to the theme OnSurfaceVariant; override to pin a colour.',
      category: CAT_CONNECTORS, default: new SolidColorBrush(Color.FromHex('#475569')) },

    { key: BoardSettingKey.ChromeHandleFill, label: 'Handle fill',
      description: 'Interior fill of grabbable handles (resize squares, text grips).',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#ffffff')) },
    { key: BoardSettingKey.ChromeConnectorEndpoint, label: 'Connector endpoint colour',
      description: 'Fill of a connector endpoint drag dot.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#ff5722')) },
    { key: BoardSettingKey.ChromeConnectorHandle, label: 'Connector handle colour',
      description: 'Fill of connector waypoint dots, port markers, and side-attach bars.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#ff9800')) },
    { key: BoardSettingKey.ChromeConnectorSegment, label: 'Connector segment colour',
      description: 'Fill of a connector mid-segment drag pad.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#2196f3')) },
    { key: BoardSettingKey.ChromeNeutralInk, label: 'Neutral affordance ink',
      description: 'Neutral slate used for the callout leader line and cap-preview glyphs.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#64748b')) },
    { key: BoardSettingKey.ChromeLayoutPreviewBackdrop, label: 'Layout preview backdrop',
      description: 'Opaque fill the layout-preview overlay paints over the canvas to hide the current board. Defaults to the theme Surface.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#ffffff')) },
    { key: BoardSettingKey.ChromeLayoutPreviewNodeFill, label: 'Layout preview node fill',
      description: 'Faint fill of each proposed node block in the layout-preview overlay.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#3b82f63d')) },
    { key: BoardSettingKey.ChromeLayoutPreviewStroke, label: 'Layout preview stroke',
      description: 'Outline of proposed node blocks and the connector lines in the layout-preview overlay.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#1976d2')) },
];

const COLOR_DEFAULTS: ReadonlyMap<BoardSettingKey, SolidColorBrush> =
    new Map(COLOR_SPECS.map(s => [s.key, s.default]));

// The choice-valued sibling of BoardSettingSpec — a fixed option list.
// Surfaces in a settings pane as a picker (SettingKind.Choice). `default` and the
// `choices` entries are the verbatim option strings (enum values).
interface BoardChoiceSettingSpec
{
    readonly key:         BoardSettingKey;
    readonly label:       string;
    readonly description: string;
    readonly category:    string;
    readonly default:     string;
    readonly choices:     readonly string[];
}

const CHOICE_SPECS: readonly BoardChoiceSettingSpec[] =
[
    { key: BoardSettingKey.ConnectorSidePortsOptimizer, label: 'Side ports optimizer',
      description: 'Which optimizer orders connectors that share a node side. Optimized (default) is a fast barycenter heuristic. BruteForce runs an exhaustive crossing-minimising search — the best result, but costly: it can hang for minutes on a large hub, and still cannot guarantee zero crossings on a non-planar graph.',
      category: CAT_CONNECTORS, default: SidePortsOptimizer.Optimized,
      choices: [SidePortsOptimizer.Optimized, SidePortsOptimizer.BruteForce] },
];

const CHOICE_DEFAULTS: ReadonlyMap<BoardSettingKey, string> =
    new Map(CHOICE_SPECS.map(s => [s.key, s.default]));

// ── Theme-linked colour defaults ───────────────────────────────────────
//
// A colour whose DEFAULT tracks the active theme scheme rather than a fixed
// hex, so the board surface reads correctly in both light and dark. The
// contract: the setting seeds an UNDEFINED default (see Definitions), so when
// the user has NOT overridden it the accessor resolves `token` against the
// live scheme; a genuine user override still persists and wins; the compiled
// COLOR_SPECS brush survives only as the no-theme fallback (tests / embeds).
//
// `alpha` (0–255), when set, re-tints the resolved token — used for the ruler-
// hover Primary WASH, since the raw @Primary token is opaque.
interface ThemeLink { readonly token: string; readonly alpha?: number; }

const THEME_LINK: ReadonlyMap<BoardSettingKey, ThemeLink> = new Map<BoardSettingKey, ThemeLink>([
    [BoardSettingKey.ShapeLabelInk,          { token: 'Ink' }],
    [BoardSettingKey.ConnectorDefaultStroke, { token: 'InkVariant' }],
    [BoardSettingKey.ContainerDefaultFill,   { token: 'AccentInk', alpha: 28 }], // ≈ 11% brand wash
    [BoardSettingKey.RulerFill,              { token: 'SurfaceBg' }],
    [BoardSettingKey.RulerTickColor,         { token: 'InkVariant' }],
    [BoardSettingKey.RulerHoverFill,         { token: 'AccentInk', alpha: 41 }], // ≈ 16%
    [BoardSettingKey.ChromeLayoutPreviewBackdrop, { token: 'SurfaceBg' }],       // opaque — hides the live board
    [BoardSettingKey.ChromeLayoutPreviewNodeFill, { token: 'AccentInk', alpha: 61 }], // ≈ 24% brand wash
    [BoardSettingKey.ChromeLayoutPreviewStroke,   { token: 'AccentInk' }],
]);

// Every catalogued key, numeric + colour + choice — the change-listener wiring
// binds all.
const ALL_KEYS: readonly BoardSettingKey[] =
    [...SPECS.map(s => s.key), ...COLOR_SPECS.map(s => s.key), ...CHOICE_SPECS.map(s => s.key)];

// Static resolver for every tunable Board constant. Each accessor returns the
// live value from the app's ApplicationSettings when one is reachable (and the
// key has a value), else the compiled-in default — so the board works
// unchanged with no settings host (tests, embeds) yet honours a user override
// live when a shell provides one.
//
// The helper is the single source of truth: it OWNS the definitions and, the
// first time it reaches an ApplicationSettings, contributes them (idempotently)
// so they surface in a settings pane with zero markup. Change notification lets
// the Board re-layout when a value is edited (see Subscribe).
export class BoardSettings
{
    private constructor() { /* static-only */ }

    // The ApplicationSettings the helper is currently bound to (definitions
    // contributed, change listeners wired). Re-resolved on every read so a new
    // Application (tests reset Application.current) re-binds transparently.
    private static _service: ApplicationSettings | undefined = undefined;

    // Subscribers notified when any Board setting's value changes.
    private static readonly _listeners = new Set<() => void>();

    // Resolve the app's ApplicationSettings (root-registered — see EditorShell /
    // Plexus app.mu). On first bind to a given service instance, publish the
    // definitions and wire per-setting change → _emit. Returns undefined when no
    // settings host exists (callers fall back to the compiled-in default).
    private static resolve(): ApplicationSettings | undefined
    {
        const svc = Application.current?.Services.get(ApplicationSettings.Key);
        if (svc === BoardSettings._service) return svc;
        BoardSettings._service = svc;
        if (svc !== undefined)
        {
            svc.Contribute(BoardSettings.Definitions());
            for (const key of ALL_KEYS)
            {
                svc.GetSetting(key)?.PropertyChanged(Setting.ValueKey).subscribe(BoardSettings._emit);
            }
        }
        return svc;
    }

    private static readonly _emit = (): void =>
    {
        for (const listener of [...BoardSettings._listeners]) listener();
    };

    // A light/dark theme swap changes the scheme tokens our theme-linked
    // defaults resolve against (RulerFill = @Surface, ShapeLabelInk = @OnSurface,
    // ConnectorDefaultStroke = @OnSurfaceVariant, …) WITHOUT touching any Setting
    // value — so the per-setting listeners in resolve() never fire. Route the
    // ThemeManager's activation into the same change signal so every
    // BoardSettings.Subscribe consumer (the Board) re-reads and repaints on a
    // scheme swap. Wired once at class load; _emit is a stable ref and
    // AddActivatedListener dedups. (Without this the rulers keep the previous
    // scheme's colours — a dark @Surface reads as a black strip in light mode.)
    static { ThemeManager.AddActivatedListener(BoardSettings._emit); }

    // Subscribe to "a Board setting changed". Returns an unsubscribe thunk.
    // Resolving here also binds/publishes to the settings host if one now exists.
    public static Subscribe(listener: () => void): () => void
    {
        BoardSettings._listeners.add(listener);
        BoardSettings.resolve();
        return () => { BoardSettings._listeners.delete(listener); };
    }

    // The schema for every tunable Board constant, freshly built. Consumed
    // internally (self-publish) and available for a host that prefers to
    // register them explicitly.
    public static Definitions(): SettingDefinition[]
    {
        const numeric = SPECS.map(spec =>
        {
            const d = new SettingDefinition();
            d.Key         = spec.key;
            d.Label       = spec.label;
            d.Description = spec.description;
            d.Category    = spec.category;
            d.Kind        = SettingKind.Number;
            d.Default     = spec.default;
            d.Min         = spec.min;
            d.Max         = spec.max;
            return d;
        });
        const color = COLOR_SPECS.map(spec =>
        {
            const d = new SettingDefinition();
            d.Key         = spec.key;
            d.Label       = spec.label;
            d.Description = spec.description;
            d.Category    = spec.category;
            d.Kind        = SettingKind.Color;
            // Theme-linked colours seed NO baked default — the accessor derives
            // their default from the active scheme (see color / THEME_LINK) so
            // the surface tracks light/dark. A user override still persists and
            // wins; the compiled brush is only the no-theme fallback.
            d.Default     = THEME_LINK.has(spec.key) ? undefined : spec.default;
            return d;
        });
        const choice = CHOICE_SPECS.map(spec =>
        {
            const d = new SettingDefinition();
            d.Key         = spec.key;
            d.Label       = spec.label;
            d.Description = spec.description;
            d.Category    = spec.category;
            d.Kind        = SettingKind.Choice;
            d.Default     = spec.default;
            d.Choices     = new ObservableCollection<string>([...spec.choices]);
            return d;
        });
        return [...numeric, ...color, ...choice];
    }

    private static num(key: BoardSettingKey): number
    {
        const value = BoardSettings.resolve()?.Get(key);
        return typeof value === 'number' ? value : DEFAULTS.get(key)!;
    }

    private static choice(key: BoardSettingKey): string
    {
        const value = BoardSettings.resolve()?.Get(key);
        return typeof value === 'string' ? value : CHOICE_DEFAULTS.get(key)!;
    }

    private static color(key: BoardSettingKey): SolidColorBrush
    {
        // A brush present in the settings host is honoured directly. For a
        // NON-linked key that is its seeded compiled default (unchanged
        // behaviour); for a THEME-LINKED key the seed is undefined, so a brush
        // here can only be a genuine user override — which still wins.
        const value = BoardSettings.resolve()?.Get(key);
        if (value instanceof SolidColorBrush) return value;

        // No override. Theme-linked → resolve the live scheme token so the
        // default tracks light/dark.
        const link = THEME_LINK.get(key);
        if (link !== undefined)
        {
            const themed = BoardSettings.themeBrush(link.token, link.alpha);
            if (themed !== undefined) return themed;
        }

        // Final fallback — the compiled-in constant (no settings host and/or no
        // reachable theme: tests, embeds, headless).
        return COLOR_DEFAULTS.get(key)!;
    }

    // Resolve a theme token (e.g. 'OnSurface') to a live brush against the
    // ACTIVE scheme, via the app-level merged resource dictionary the
    // ThemeManager maintains on Application.Resources. Returns undefined when
    // no Application / theme is reachable so the caller falls back to a compiled
    // default. `alpha` (0–255), when given, re-tints the resolved colour (the
    // token itself is opaque) — used for wash fills.
    private static themeBrush(token: string, alpha?: number): SolidColorBrush | undefined
    {
        const resolved = Application.current?.Resources?.Resolve(token);
        let color: Color | undefined;
        if (resolved instanceof SolidColorBrush) color = resolved.Color;
        else if (resolved instanceof Color)      color = resolved;
        if (color === undefined) return undefined;

        if (alpha !== undefined) return new SolidColorBrush(color.WithAlpha(alpha));
        // Untinted: reuse the token's own brush instance when it is one (its
        // identity is paid once at scheme registration); else wrap the Color.
        return resolved instanceof SolidColorBrush ? resolved : new SolidColorBrush(color);
    }

    // ── Icons ────────────────────────────────────────────────────────────
    public static DefaultIconWidth():  number { return BoardSettings.num(BoardSettingKey.DefaultIconWidth); }
    public static DefaultIconHeight(): number { return BoardSettings.num(BoardSettingKey.DefaultIconHeight); }

    // ── Shapes ───────────────────────────────────────────────────────────
    public static ShapeDefaultSize():    number { return BoardSettings.num(BoardSettingKey.ShapeDefaultSize); }
    public static ShapeLabelMargin():    number { return BoardSettings.num(BoardSettingKey.ShapeLabelMargin); }
    public static ShapeStrokeWidth():    number { return BoardSettings.num(BoardSettingKey.ShapeStrokeWidth); }
    public static ShapeMinResize():      number { return BoardSettings.num(BoardSettingKey.ShapeMinResize); }
    public static ShapeDefaultFill():    SolidColorBrush { return BoardSettings.color(BoardSettingKey.ShapeDefaultFill); }
    public static ShapeDefaultStroke():  SolidColorBrush { return BoardSettings.color(BoardSettingKey.ShapeDefaultStroke); }
    public static ShapeLabelInk():       SolidColorBrush { return BoardSettings.color(BoardSettingKey.ShapeLabelInk); }
    public static TextDefaultFontSize(): number { return BoardSettings.num(BoardSettingKey.TextDefaultFontSize); }
    public static TextNodeFill():        SolidColorBrush { return BoardSettings.color(BoardSettingKey.TextNodeFill); }
    public static TextNodeStroke():      SolidColorBrush { return BoardSettings.color(BoardSettingKey.TextNodeStroke); }
    public static ContainerDefaultFill():   SolidColorBrush { return BoardSettings.color(BoardSettingKey.ContainerDefaultFill); }

    // ── Connectors ───────────────────────────────────────────────────────
    public static ConnectorStrokeWidth():     number { return BoardSettings.num(BoardSettingKey.ConnectorStrokeWidth); }
    public static ConnectorDefaultStroke():   SolidColorBrush { return BoardSettings.color(BoardSettingKey.ConnectorDefaultStroke); }
    public static ConnectorHitWidth():        number { return BoardSettings.num(BoardSettingKey.ConnectorHitWidth); }
    public static ConnectorOrthogonalStub():  number { return BoardSettings.num(BoardSettingKey.ConnectorOrthogonalStub); }
    public static ConnectorLaneGap():         number { return BoardSettings.num(BoardSettingKey.ConnectorLaneGap); }
    public static ConnectorBezierMinOffset(): number { return BoardSettings.num(BoardSettingKey.ConnectorBezierMinOffset); }
    public static ConnectorSegmentJogStub():  number { return BoardSettings.num(BoardSettingKey.ConnectorSegmentJogStub); }
    public static ConnectorJogMargin():       number { return BoardSettings.num(BoardSettingKey.ConnectorJogMargin); }
    // Which side-port crossing optimizer runs. Optimized (default) is the fast
    // barycenter heuristic; BruteForce is the exhaustive O(k⁴) hill-climb. An
    // unrecognised persisted value falls back to Optimized.
    public static SidePortsOptimizer(): SidePortsOptimizer
    {
        return BoardSettings.choice(BoardSettingKey.ConnectorSidePortsOptimizer) === SidePortsOptimizer.BruteForce
            ? SidePortsOptimizer.BruteForce
            : SidePortsOptimizer.Optimized;
    }

    // ── Editing chrome ───────────────────────────────────────────────────
    public static EndpointHandleSize():    number { return BoardSettings.num(BoardSettingKey.ChromeEndpointHandleSize); }
    public static WaypointHandleSize():    number { return BoardSettings.num(BoardSettingKey.ChromeWaypointHandleSize); }
    public static SegmentHandleSize():     number { return BoardSettings.num(BoardSettingKey.ChromeSegmentHandleSize); }
    public static PortMarkerSize():        number { return BoardSettings.num(BoardSettingKey.ChromePortMarkerSize); }
    public static SideBarThickness():      number { return BoardSettings.num(BoardSettingKey.ChromeSideBarThickness); }
    public static FigureProximity():       number { return BoardSettings.num(BoardSettingKey.ChromeFigureProximity); }
    public static HoverHaloMinThickness(): number { return BoardSettings.num(BoardSettingKey.ChromeHoverHaloMinThickness); }
    public static HoverHaloOpacity():      number { return BoardSettings.num(BoardSettingKey.ChromeHoverHaloOpacity); }
    public static TextHandleSize():        number { return BoardSettings.num(BoardSettingKey.ChromeTextHandleSize); }
    public static TextRotateGap():         number { return BoardSettings.num(BoardSettingKey.ChromeTextRotateGap); }
    public static TextStemWidth():         number { return BoardSettings.num(BoardSettingKey.ChromeTextStemWidth); }
    public static GuideThickness():        number { return BoardSettings.num(BoardSettingKey.ChromeGuideThickness); }
    public static PersistentGuideThickness(): number         { return BoardSettings.num(BoardSettingKey.ChromePersistentGuideThickness); }
    public static GuideGrabTolerance():       number         { return BoardSettings.num(BoardSettingKey.ChromeGuideGrabTolerance); }
    public static GuideCreateMargin():        number         { return BoardSettings.num(BoardSettingKey.ChromeGuideCreateMargin); }
    public static PersistentGuideColor():     SolidColorBrush { return BoardSettings.color(BoardSettingKey.ChromePersistentGuideColor); }
    public static PersistentGuideSelectedColor(): SolidColorBrush { return BoardSettings.color(BoardSettingKey.ChromePersistentGuideSelectedColor); }
    public static PersistentGuidePreviewColor():  SolidColorBrush { return BoardSettings.color(BoardSettingKey.ChromePersistentGuidePreviewColor); }
    public static HandleFill():            SolidColorBrush { return BoardSettings.color(BoardSettingKey.ChromeHandleFill); }
    public static ConnectorEndpointColor():SolidColorBrush { return BoardSettings.color(BoardSettingKey.ChromeConnectorEndpoint); }
    public static ConnectorHandleColor():  SolidColorBrush { return BoardSettings.color(BoardSettingKey.ChromeConnectorHandle); }
    public static ConnectorSegmentColor(): SolidColorBrush { return BoardSettings.color(BoardSettingKey.ChromeConnectorSegment); }
    public static NeutralInk():            SolidColorBrush { return BoardSettings.color(BoardSettingKey.ChromeNeutralInk); }
    public static LayoutPreviewBackdrop(): SolidColorBrush { return BoardSettings.color(BoardSettingKey.ChromeLayoutPreviewBackdrop); }
    public static LayoutPreviewNodeFill(): SolidColorBrush { return BoardSettings.color(BoardSettingKey.ChromeLayoutPreviewNodeFill); }
    public static LayoutPreviewStroke():   SolidColorBrush { return BoardSettings.color(BoardSettingKey.ChromeLayoutPreviewStroke); }

    // ── Toolbox ──────────────────────────────────────────────────────────
    public static ToolboxTileSize():    number          { return BoardSettings.num(BoardSettingKey.ToolboxTileSize); }
    public static ToolboxPreviewFill(): SolidColorBrush { return BoardSettings.color(BoardSettingKey.ToolboxPreviewFill); }

    // ── Rulers ───────────────────────────────────────────────────────────
    public static RulerThickness():      number          { return BoardSettings.num(BoardSettingKey.RulerThickness); }
    public static RulerTickMinSpacing(): number          { return BoardSettings.num(BoardSettingKey.RulerTickMinSpacing); }
    public static RulerFill():           SolidColorBrush { return BoardSettings.color(BoardSettingKey.RulerFill); }
    public static RulerTickColor():      SolidColorBrush { return BoardSettings.color(BoardSettingKey.RulerTickColor); }
    public static RulerHoverFill():      SolidColorBrush { return BoardSettings.color(BoardSettingKey.RulerHoverFill); }
}
