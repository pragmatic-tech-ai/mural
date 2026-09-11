import { Application, Color, ThemeManager } from '../../runtime/index.js';
import { SolidColorBrush } from '../../visual-engine/index.js';
import { ApplicationSettings } from '../shell/services/application-settings-service.js';
import { SettingDefinition, SettingKind } from '../shell/settings/setting-definition.js';
import { Setting } from '../shell/settings/setting.js';

// Stable keys for every tunable Diagram constant. A fixed set of named string
// values → an enum (per the no-string-literal-unions rule). Internal only:
// authors never write these in markup — the helper self-publishes its
// definitions to ApplicationSettings — so no symbol-table registration is
// needed. Values are namespaced by concern (shape / connector / chrome) and
// are the persistence + lookup keys.
export enum DiagramSettingKey
{
    ShapeDefaultSize            = 'diagram.shape.defaultSize',
    ShapeLabelMargin            = 'diagram.shape.labelMargin',
    ShapeStrokeWidth            = 'diagram.shape.strokeWidth',
    ShapeMinResize              = 'diagram.shape.minResize',
    ShapeDefaultFill            = 'diagram.shape.defaultFill',
    ShapeDefaultStroke          = 'diagram.shape.defaultStroke',
    ShapeLabelInk               = 'diagram.shape.labelInk',
    ContainerDefaultFill        = 'diagram.container.defaultFill',
    TextDefaultFontSize         = 'diagram.text.defaultFontSize',
    TextNodeFill                = 'diagram.text.nodeFill',
    TextNodeStroke              = 'diagram.text.nodeStroke',

    ConnectorStrokeWidth        = 'diagram.connector.strokeWidth',
    ConnectorDefaultStroke      = 'diagram.connector.defaultStroke',
    ConnectorHitWidth           = 'diagram.connector.hitWidth',
    ConnectorOrthogonalStub     = 'diagram.connector.orthogonalStub',
    ConnectorLaneGap            = 'diagram.connector.laneGap',
    ConnectorBezierMinOffset    = 'diagram.connector.bezierMinOffset',
    ConnectorSegmentJogStub     = 'diagram.connector.segmentJogStub',
    ConnectorJogMargin          = 'diagram.connector.jogMargin',

    ChromeEndpointHandleSize    = 'diagram.chrome.endpointHandleSize',
    ChromeWaypointHandleSize    = 'diagram.chrome.waypointHandleSize',
    ChromeSegmentHandleSize     = 'diagram.chrome.segmentHandleSize',
    ChromePortMarkerSize        = 'diagram.chrome.portMarkerSize',
    ChromeSideBarThickness      = 'diagram.chrome.sideBarThickness',
    ChromeFigureProximity       = 'diagram.chrome.figureProximity',
    ChromeHoverHaloMinThickness = 'diagram.chrome.hoverHaloMinThickness',
    ChromeHoverHaloOpacity      = 'diagram.chrome.hoverHaloOpacity',
    ChromeTextHandleSize        = 'diagram.chrome.textHandleSize',
    ChromeTextRotateGap         = 'diagram.chrome.textRotateGap',
    ChromeTextStemWidth         = 'diagram.chrome.textStemWidth',
    ChromeGuideThickness        = 'diagram.chrome.guideThickness',
    ChromePersistentGuideThickness = 'diagram.chrome.persistentGuideThickness',
    ChromeGuideGrabTolerance       = 'diagram.chrome.guideGrabTolerance',
    ChromeGuideCreateMargin        = 'diagram.chrome.guideCreateMargin',
    ChromePersistentGuideColor     = 'diagram.chrome.persistentGuideColor',
    ChromePersistentGuideSelectedColor = 'diagram.chrome.persistentGuideSelectedColor',
    ChromePersistentGuidePreviewColor  = 'diagram.chrome.persistentGuidePreviewColor',
    ChromeHandleFill               = 'diagram.chrome.handleFill',
    ChromeConnectorEndpoint        = 'diagram.chrome.connectorEndpoint',
    ChromeConnectorHandle          = 'diagram.chrome.connectorHandle',
    ChromeConnectorSegment         = 'diagram.chrome.connectorSegment',
    ChromeNeutralInk               = 'diagram.chrome.neutralInk',
    ChromeLayoutPreviewBackdrop    = 'diagram.chrome.layoutPreviewBackdrop',
    ChromeLayoutPreviewNodeFill    = 'diagram.chrome.layoutPreviewNodeFill',
    ChromeLayoutPreviewStroke      = 'diagram.chrome.layoutPreviewStroke',

    ToolboxTileSize             = 'diagram.toolbox.tileSize',
    ToolboxPreviewFill          = 'diagram.toolbox.previewFill',

    RulerThickness              = 'diagram.ruler.thickness',
    RulerTickMinSpacing         = 'diagram.ruler.tickMinSpacing',
    RulerFill                   = 'diagram.ruler.fill',
    RulerTickColor              = 'diagram.ruler.tickColor',
    RulerHoverFill              = 'diagram.ruler.hoverFill',
}

// One catalogue row: the schema for a tunable constant. The `default` is the
// compiled-in constant value — the fallback the helper returns when no
// ApplicationSettings is reachable (tests, non-shell hosts) or the key is
// unset. `min`/`max` bound the Number editor in a settings pane.
interface DiagramSettingSpec
{
    readonly key:         DiagramSettingKey;
    readonly label:       string;
    readonly description: string;
    readonly category:    string;
    readonly default:     number;
    readonly min:         number;
    readonly max:         number;
}

const CAT_SHAPES     = 'Diagram · Shapes';
const CAT_CONNECTORS = 'Diagram · Connectors';
const CAT_CHROME     = 'Diagram · Editing chrome';
const CAT_TOOLBOX    = 'Diagram · Toolbox';
const CAT_RULERS     = 'Diagram · Rulers';

// The single source of truth for every tunable Diagram constant. Each row's
// `default` is the historical hard-coded value; the diagram reads through the
// helper so a user override in ApplicationSettings takes over live.
const SPECS: readonly DiagramSettingSpec[] =
[
    { key: DiagramSettingKey.ShapeDefaultSize, label: 'Default shape size',
      description: 'Width & height of a newly-placed shape, in pixels.',
      category: CAT_SHAPES, default: 80, min: 8, max: 400 },
    { key: DiagramSettingKey.ShapeLabelMargin, label: 'Shape label margin',
      description: 'Slack around a label when a shape grows to fit its text.',
      category: CAT_SHAPES, default: 8, min: 0, max: 64 },
    { key: DiagramSettingKey.ShapeStrokeWidth, label: 'Shape stroke width',
      description: 'Outline thickness of a newly-placed shape, in pixels.',
      category: CAT_SHAPES, default: 1.5, min: 0, max: 16 },
    { key: DiagramSettingKey.ShapeMinResize, label: 'Minimum shape size',
      description: 'Smallest width or height a shape can be resized to.',
      category: CAT_SHAPES, default: 8, min: 1, max: 64 },
    { key: DiagramSettingKey.TextDefaultFontSize, label: 'Default label font size',
      description: 'Font size used for a new shape label, in points.',
      category: CAT_SHAPES, default: 12, min: 4, max: 96 },

    { key: DiagramSettingKey.ConnectorStrokeWidth, label: 'Connector stroke width',
      description: 'Line thickness of a newly-drawn connector, in pixels.',
      category: CAT_CONNECTORS, default: 1.5, min: 0, max: 16 },
    { key: DiagramSettingKey.ConnectorHitWidth, label: 'Connector hit width',
      description: 'Width of the invisible click/hover band around a connector.',
      category: CAT_CONNECTORS, default: 14, min: 2, max: 48 },
    { key: DiagramSettingKey.ConnectorOrthogonalStub, label: 'Orthogonal stub length',
      description: 'How far an orthogonal route extends straight out of a port.',
      category: CAT_CONNECTORS, default: 20, min: 0, max: 120 },
    { key: DiagramSettingKey.ConnectorLaneGap, label: 'Connector lane gap',
      description: 'Lateral spacing between connectors sharing a side.',
      category: CAT_CONNECTORS, default: 10, min: 0, max: 60 },
    { key: DiagramSettingKey.ConnectorBezierMinOffset, label: 'Bezier minimum offset',
      description: 'Minimum control-point pull for a curved connector.',
      category: CAT_CONNECTORS, default: 20, min: 0, max: 120 },
    { key: DiagramSettingKey.ConnectorSegmentJogStub, label: 'Segment jog stub',
      description: 'Jog offset from a pinned port when dragging a segment.',
      category: CAT_CONNECTORS, default: 20, min: 0, max: 120 },
    { key: DiagramSettingKey.ConnectorJogMargin, label: 'Segment jog margin',
      description: 'Extra margin past the router stub for a jog anchor.',
      category: CAT_CONNECTORS, default: 6, min: 0, max: 60 },

    { key: DiagramSettingKey.ChromeEndpointHandleSize, label: 'Endpoint handle size',
      description: 'Size of a connector endpoint drag dot, in pixels.',
      category: CAT_CHROME, default: 11, min: 4, max: 32 },
    { key: DiagramSettingKey.ChromeWaypointHandleSize, label: 'Waypoint handle size',
      description: 'Size of a connector waypoint (corner) drag dot, in pixels.',
      category: CAT_CHROME, default: 9, min: 4, max: 32 },
    { key: DiagramSettingKey.ChromeSegmentHandleSize, label: 'Segment handle size',
      description: 'Size of a mid-segment drag pad, in pixels.',
      category: CAT_CHROME, default: 9, min: 4, max: 32 },
    { key: DiagramSettingKey.ChromePortMarkerSize, label: 'Port marker size',
      description: 'Size of a port-slot indicator on a hovered shape, in pixels.',
      category: CAT_CHROME, default: 7, min: 3, max: 24 },
    { key: DiagramSettingKey.ChromeSideBarThickness, label: 'Side-bar thickness',
      description: 'Thickness of a hovered shape’s side-attach bars, in pixels.',
      category: CAT_CHROME, default: 3, min: 1, max: 16 },
    { key: DiagramSettingKey.ChromeFigureProximity, label: 'Shape proximity tolerance',
      description: 'Cursor distance at which a shape’s attach chrome appears.',
      category: CAT_CHROME, default: 8, min: 0, max: 48 },
    { key: DiagramSettingKey.ChromeHoverHaloMinThickness, label: 'Hover halo min thickness',
      description: 'Minimum stroke width of the connector hover halo, in pixels.',
      category: CAT_CHROME, default: 5, min: 1, max: 24 },
    { key: DiagramSettingKey.ChromeHoverHaloOpacity, label: 'Hover halo opacity',
      description: 'Opacity of the connector hover halo (0–1).',
      category: CAT_CHROME, default: 0.45, min: 0, max: 1 },
    { key: DiagramSettingKey.ChromeTextHandleSize, label: 'Text handle size',
      description: 'Size of a text-block move/rotate grip, in pixels.',
      category: CAT_CHROME, default: 9, min: 4, max: 32 },
    { key: DiagramSettingKey.ChromeTextRotateGap, label: 'Text rotate-grip gap',
      description: 'Distance from a text block’s top edge to its rotate grip.',
      category: CAT_CHROME, default: 18, min: 0, max: 64 },
    { key: DiagramSettingKey.ChromeTextStemWidth, label: 'Text rotate-stem width',
      description: 'Line width of a text block’s rotate stem, in pixels.',
      category: CAT_CHROME, default: 1, min: 1, max: 8 },
    { key: DiagramSettingKey.ChromeGuideThickness, label: 'Alignment guide thickness',
      description: 'Line thickness of a snap alignment guide, in pixels.',
      category: CAT_CHROME, default: 1, min: 1, max: 8 },
    { key: DiagramSettingKey.ChromePersistentGuideThickness, label: 'Persistent guide thickness',
      description: 'Line thickness of a user-placed ruler guide, in pixels.',
      category: CAT_CHROME, default: 1, min: 1, max: 8 },
    { key: DiagramSettingKey.ChromeGuideGrabTolerance, label: 'Guide grab tolerance',
      description: 'Cursor distance at which a ruler guide can be grabbed/selected, in pixels.',
      category: CAT_CHROME, default: 6, min: 1, max: 24 },
    { key: DiagramSettingKey.ChromeGuideCreateMargin, label: 'Guide create margin',
      description: 'Canvas band next to a ruler where a drag pulls out a new guide, in pixels.',
      category: CAT_CHROME, default: 14, min: 0, max: 48 },

    { key: DiagramSettingKey.ToolboxTileSize, label: 'Toolbox tile size',
      description: 'Width & height of a shape preview tile in the toolbox, in pixels.',
      category: CAT_TOOLBOX, default: 48, min: 16, max: 128 },

    { key: DiagramSettingKey.RulerThickness, label: 'Ruler thickness',
      description: 'Width/height of the ruler strips along the viewport edges, in pixels.',
      category: CAT_RULERS, default: 20, min: 12, max: 48 },
    { key: DiagramSettingKey.RulerTickMinSpacing, label: 'Ruler tick minimum spacing',
      description: 'Smallest on-screen gap between labelled ruler ticks, in pixels.',
      category: CAT_RULERS, default: 60, min: 24, max: 200 },
];

const DEFAULTS: ReadonlyMap<DiagramSettingKey, number> =
    new Map(SPECS.map(s => [s.key, s.default]));

// The colour-valued sibling of DiagramSettingSpec. A Color setting carries a
// live SolidColorBrush (the service persists it as hex and restores the brush),
// so it needs no numeric bounds — just a brush `default`.
interface DiagramColorSettingSpec
{
    readonly key:         DiagramSettingKey;
    readonly label:       string;
    readonly description: string;
    readonly category:    string;
    readonly default:     SolidColorBrush;
}

const COLOR_SPECS: readonly DiagramColorSettingSpec[] =
[
    { key: DiagramSettingKey.ShapeDefaultFill, label: 'Default shape fill',
      description: 'Fill brush of a freshly-placed shape. Reads on the surface in both schemes.',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#bfdbfe')) },
    { key: DiagramSettingKey.ShapeDefaultStroke, label: 'Default shape stroke',
      description: 'Stroke brush of a freshly-placed shape (width comes from Shape stroke width).',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#1976d2')) },
    { key: DiagramSettingKey.ToolboxPreviewFill, label: 'Toolbox preview fill',
      description: 'Fill colour of a shape preview tile in the toolbox.',
      category: CAT_TOOLBOX, default: new SolidColorBrush(Color.FromHex('#1976d2')) },
    { key: DiagramSettingKey.ChromePersistentGuideColor, label: 'Persistent guide colour',
      description: 'Colour of a user-placed ruler guide line.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#e5484d')) },
    { key: DiagramSettingKey.ChromePersistentGuideSelectedColor, label: 'Selected guide colour',
      description: 'Colour of the currently-selected ruler guide line.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#f59e0b')) },
    { key: DiagramSettingKey.ChromePersistentGuidePreviewColor, label: 'Guide preview colour',
      description: 'Colour of the faint preview line shown while hovering a guide drag-out zone.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#e5484d')) },
    { key: DiagramSettingKey.RulerFill, label: 'Ruler fill',
      description: 'Background fill of the ruler strips. Defaults to the theme Surface; override to pin a colour.',
      category: CAT_RULERS, default: new SolidColorBrush(Color.FromHex('#f3f4f6')) },
    { key: DiagramSettingKey.RulerTickColor, label: 'Ruler tick colour',
      description: 'Colour of ruler tick marks and labels. Defaults to the theme OnSurfaceVariant; override to pin a colour.',
      category: CAT_RULERS, default: new SolidColorBrush(Color.FromHex('#6b7280')) },
    { key: DiagramSettingKey.RulerHoverFill, label: 'Ruler hover fill',
      description: 'Accent wash painted over a ruler strip while the pointer is over it. Defaults to a theme Primary wash; override to pin a colour.',
      category: CAT_RULERS, default: new SolidColorBrush(Color.FromHex('#dbeafe')) },

    { key: DiagramSettingKey.ShapeLabelInk, label: 'Shape label ink',
      description: 'Default text colour of a shape label. Defaults to the theme OnSurface; override to pin a colour.',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#000000')) },
    { key: DiagramSettingKey.TextNodeFill, label: 'Text-node fill',
      description: 'Fill of a text box node (transparent by default).',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#00000000')) },
    { key: DiagramSettingKey.TextNodeStroke, label: 'Text-node stroke',
      description: 'Outline colour of a text box node.',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#94a3b8')) },

    { key: DiagramSettingKey.ContainerDefaultFill, label: 'Container fill',
      description: 'Faint brand wash of a content (VM-backed) container box, so it reads as a box that holds children. Defaults to a theme Primary wash; override to pin a colour. Its border reuses the shape default stroke.',
      category: CAT_SHAPES, default: new SolidColorBrush(Color.FromHex('#3b82f61c')) },
    { key: DiagramSettingKey.ConnectorDefaultStroke, label: 'Default connector stroke',
      description: 'Line colour of a freshly-drawn connector. Defaults to the theme OnSurfaceVariant; override to pin a colour.',
      category: CAT_CONNECTORS, default: new SolidColorBrush(Color.FromHex('#475569')) },

    { key: DiagramSettingKey.ChromeHandleFill, label: 'Handle fill',
      description: 'Interior fill of grabbable handles (resize squares, text grips).',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#ffffff')) },
    { key: DiagramSettingKey.ChromeConnectorEndpoint, label: 'Connector endpoint colour',
      description: 'Fill of a connector endpoint drag dot.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#ff5722')) },
    { key: DiagramSettingKey.ChromeConnectorHandle, label: 'Connector handle colour',
      description: 'Fill of connector waypoint dots, port markers, and side-attach bars.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#ff9800')) },
    { key: DiagramSettingKey.ChromeConnectorSegment, label: 'Connector segment colour',
      description: 'Fill of a connector mid-segment drag pad.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#2196f3')) },
    { key: DiagramSettingKey.ChromeNeutralInk, label: 'Neutral affordance ink',
      description: 'Neutral slate used for the callout leader line and cap-preview glyphs.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#64748b')) },
    { key: DiagramSettingKey.ChromeLayoutPreviewBackdrop, label: 'Layout preview backdrop',
      description: 'Opaque fill the layout-preview overlay paints over the canvas to hide the current diagram. Defaults to the theme Surface.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#ffffff')) },
    { key: DiagramSettingKey.ChromeLayoutPreviewNodeFill, label: 'Layout preview node fill',
      description: 'Faint fill of each proposed node block in the layout-preview overlay.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#3b82f63d')) },
    { key: DiagramSettingKey.ChromeLayoutPreviewStroke, label: 'Layout preview stroke',
      description: 'Outline of proposed node blocks and the connector lines in the layout-preview overlay.',
      category: CAT_CHROME, default: new SolidColorBrush(Color.FromHex('#1976d2')) },
];

const COLOR_DEFAULTS: ReadonlyMap<DiagramSettingKey, SolidColorBrush> =
    new Map(COLOR_SPECS.map(s => [s.key, s.default]));

// ── Theme-linked colour defaults ───────────────────────────────────────
//
// A colour whose DEFAULT tracks the active theme scheme rather than a fixed
// hex, so the diagram surface reads correctly in both light and dark. The
// contract: the setting seeds an UNDEFINED default (see Definitions), so when
// the user has NOT overridden it the accessor resolves `token` against the
// live scheme; a genuine user override still persists and wins; the compiled
// COLOR_SPECS brush survives only as the no-theme fallback (tests / embeds).
//
// `alpha` (0–255), when set, re-tints the resolved token — used for the ruler-
// hover Primary WASH, since the raw @Primary token is opaque.
interface ThemeLink { readonly token: string; readonly alpha?: number; }

const THEME_LINK: ReadonlyMap<DiagramSettingKey, ThemeLink> = new Map<DiagramSettingKey, ThemeLink>([
    [DiagramSettingKey.ShapeLabelInk,          { token: 'OnSurface' }],
    [DiagramSettingKey.ConnectorDefaultStroke, { token: 'OnSurfaceVariant' }],
    [DiagramSettingKey.ContainerDefaultFill,   { token: 'Primary', alpha: 28 }], // ≈ 11% brand wash
    [DiagramSettingKey.RulerFill,              { token: 'Surface' }],
    [DiagramSettingKey.RulerTickColor,         { token: 'OnSurfaceVariant' }],
    [DiagramSettingKey.RulerHoverFill,         { token: 'Primary', alpha: 41 }], // ≈ 16%
    [DiagramSettingKey.ChromeLayoutPreviewBackdrop, { token: 'Surface' }],       // opaque — hides the live diagram
    [DiagramSettingKey.ChromeLayoutPreviewNodeFill, { token: 'Primary', alpha: 61 }], // ≈ 24% brand wash
    [DiagramSettingKey.ChromeLayoutPreviewStroke,   { token: 'Primary' }],
]);

// Every catalogued key, numeric + colour — the change-listener wiring binds all.
const ALL_KEYS: readonly DiagramSettingKey[] =
    [...SPECS.map(s => s.key), ...COLOR_SPECS.map(s => s.key)];

// Static resolver for every tunable Diagram constant. Each accessor returns the
// live value from the app's ApplicationSettings when one is reachable (and the
// key has a value), else the compiled-in default — so the diagram works
// unchanged with no settings host (tests, embeds) yet honours a user override
// live when a shell provides one.
//
// The helper is the single source of truth: it OWNS the definitions and, the
// first time it reaches an ApplicationSettings, contributes them (idempotently)
// so they surface in a settings pane with zero markup. Change notification lets
// the Diagram re-layout when a value is edited (see Subscribe).
export class DiagramSettings
{
    private constructor() { /* static-only */ }

    // The ApplicationSettings the helper is currently bound to (definitions
    // contributed, change listeners wired). Re-resolved on every read so a new
    // Application (tests reset Application.current) re-binds transparently.
    private static _service: ApplicationSettings | undefined = undefined;

    // Subscribers notified when any Diagram setting's value changes.
    private static readonly _listeners = new Set<() => void>();

    // Resolve the app's ApplicationSettings (root-registered — see EditorShell /
    // Plexus app.mu). On first bind to a given service instance, publish the
    // definitions and wire per-setting change → _emit. Returns undefined when no
    // settings host exists (callers fall back to the compiled-in default).
    private static resolve(): ApplicationSettings | undefined
    {
        const svc = Application.current?.Services.get(ApplicationSettings.Key);
        if (svc === DiagramSettings._service) return svc;
        DiagramSettings._service = svc;
        if (svc !== undefined)
        {
            svc.Contribute(DiagramSettings.Definitions());
            for (const key of ALL_KEYS)
            {
                svc.GetSetting(key)?.PropertyChanged(Setting.ValueKey).subscribe(DiagramSettings._emit);
            }
        }
        return svc;
    }

    private static readonly _emit = (): void =>
    {
        for (const listener of [...DiagramSettings._listeners]) listener();
    };

    // A light/dark theme swap changes the scheme tokens our theme-linked
    // defaults resolve against (RulerFill = @Surface, ShapeLabelInk = @OnSurface,
    // ConnectorDefaultStroke = @OnSurfaceVariant, …) WITHOUT touching any Setting
    // value — so the per-setting listeners in resolve() never fire. Route the
    // ThemeManager's activation into the same change signal so every
    // DiagramSettings.Subscribe consumer (the Diagram) re-reads and repaints on a
    // scheme swap. Wired once at class load; _emit is a stable ref and
    // AddActivatedListener dedups. (Without this the rulers keep the previous
    // scheme's colours — a dark @Surface reads as a black strip in light mode.)
    static { ThemeManager.AddActivatedListener(DiagramSettings._emit); }

    // Subscribe to "a Diagram setting changed". Returns an unsubscribe thunk.
    // Resolving here also binds/publishes to the settings host if one now exists.
    public static Subscribe(listener: () => void): () => void
    {
        DiagramSettings._listeners.add(listener);
        DiagramSettings.resolve();
        return () => { DiagramSettings._listeners.delete(listener); };
    }

    // The schema for every tunable Diagram constant, freshly built. Consumed
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
        return [...numeric, ...color];
    }

    private static num(key: DiagramSettingKey): number
    {
        const value = DiagramSettings.resolve()?.Get(key);
        return typeof value === 'number' ? value : DEFAULTS.get(key)!;
    }

    private static color(key: DiagramSettingKey): SolidColorBrush
    {
        // A brush present in the settings host is honoured directly. For a
        // NON-linked key that is its seeded compiled default (unchanged
        // behaviour); for a THEME-LINKED key the seed is undefined, so a brush
        // here can only be a genuine user override — which still wins.
        const value = DiagramSettings.resolve()?.Get(key);
        if (value instanceof SolidColorBrush) return value;

        // No override. Theme-linked → resolve the live scheme token so the
        // default tracks light/dark.
        const link = THEME_LINK.get(key);
        if (link !== undefined)
        {
            const themed = DiagramSettings.themeBrush(link.token, link.alpha);
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

    // ── Shapes ───────────────────────────────────────────────────────────
    public static ShapeDefaultSize():    number { return DiagramSettings.num(DiagramSettingKey.ShapeDefaultSize); }
    public static ShapeLabelMargin():    number { return DiagramSettings.num(DiagramSettingKey.ShapeLabelMargin); }
    public static ShapeStrokeWidth():    number { return DiagramSettings.num(DiagramSettingKey.ShapeStrokeWidth); }
    public static ShapeMinResize():      number { return DiagramSettings.num(DiagramSettingKey.ShapeMinResize); }
    public static ShapeDefaultFill():    SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ShapeDefaultFill); }
    public static ShapeDefaultStroke():  SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ShapeDefaultStroke); }
    public static ShapeLabelInk():       SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ShapeLabelInk); }
    public static TextDefaultFontSize(): number { return DiagramSettings.num(DiagramSettingKey.TextDefaultFontSize); }
    public static TextNodeFill():        SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.TextNodeFill); }
    public static TextNodeStroke():      SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.TextNodeStroke); }
    public static ContainerDefaultFill():   SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ContainerDefaultFill); }

    // ── Connectors ───────────────────────────────────────────────────────
    public static ConnectorStrokeWidth():     number { return DiagramSettings.num(DiagramSettingKey.ConnectorStrokeWidth); }
    public static ConnectorDefaultStroke():   SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ConnectorDefaultStroke); }
    public static ConnectorHitWidth():        number { return DiagramSettings.num(DiagramSettingKey.ConnectorHitWidth); }
    public static ConnectorOrthogonalStub():  number { return DiagramSettings.num(DiagramSettingKey.ConnectorOrthogonalStub); }
    public static ConnectorLaneGap():         number { return DiagramSettings.num(DiagramSettingKey.ConnectorLaneGap); }
    public static ConnectorBezierMinOffset(): number { return DiagramSettings.num(DiagramSettingKey.ConnectorBezierMinOffset); }
    public static ConnectorSegmentJogStub():  number { return DiagramSettings.num(DiagramSettingKey.ConnectorSegmentJogStub); }
    public static ConnectorJogMargin():       number { return DiagramSettings.num(DiagramSettingKey.ConnectorJogMargin); }

    // ── Editing chrome ───────────────────────────────────────────────────
    public static EndpointHandleSize():    number { return DiagramSettings.num(DiagramSettingKey.ChromeEndpointHandleSize); }
    public static WaypointHandleSize():    number { return DiagramSettings.num(DiagramSettingKey.ChromeWaypointHandleSize); }
    public static SegmentHandleSize():     number { return DiagramSettings.num(DiagramSettingKey.ChromeSegmentHandleSize); }
    public static PortMarkerSize():        number { return DiagramSettings.num(DiagramSettingKey.ChromePortMarkerSize); }
    public static SideBarThickness():      number { return DiagramSettings.num(DiagramSettingKey.ChromeSideBarThickness); }
    public static FigureProximity():       number { return DiagramSettings.num(DiagramSettingKey.ChromeFigureProximity); }
    public static HoverHaloMinThickness(): number { return DiagramSettings.num(DiagramSettingKey.ChromeHoverHaloMinThickness); }
    public static HoverHaloOpacity():      number { return DiagramSettings.num(DiagramSettingKey.ChromeHoverHaloOpacity); }
    public static TextHandleSize():        number { return DiagramSettings.num(DiagramSettingKey.ChromeTextHandleSize); }
    public static TextRotateGap():         number { return DiagramSettings.num(DiagramSettingKey.ChromeTextRotateGap); }
    public static TextStemWidth():         number { return DiagramSettings.num(DiagramSettingKey.ChromeTextStemWidth); }
    public static GuideThickness():        number { return DiagramSettings.num(DiagramSettingKey.ChromeGuideThickness); }
    public static PersistentGuideThickness(): number         { return DiagramSettings.num(DiagramSettingKey.ChromePersistentGuideThickness); }
    public static GuideGrabTolerance():       number         { return DiagramSettings.num(DiagramSettingKey.ChromeGuideGrabTolerance); }
    public static GuideCreateMargin():        number         { return DiagramSettings.num(DiagramSettingKey.ChromeGuideCreateMargin); }
    public static PersistentGuideColor():     SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ChromePersistentGuideColor); }
    public static PersistentGuideSelectedColor(): SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ChromePersistentGuideSelectedColor); }
    public static PersistentGuidePreviewColor():  SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ChromePersistentGuidePreviewColor); }
    public static HandleFill():            SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ChromeHandleFill); }
    public static ConnectorEndpointColor():SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ChromeConnectorEndpoint); }
    public static ConnectorHandleColor():  SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ChromeConnectorHandle); }
    public static ConnectorSegmentColor(): SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ChromeConnectorSegment); }
    public static NeutralInk():            SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ChromeNeutralInk); }
    public static LayoutPreviewBackdrop(): SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ChromeLayoutPreviewBackdrop); }
    public static LayoutPreviewNodeFill(): SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ChromeLayoutPreviewNodeFill); }
    public static LayoutPreviewStroke():   SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ChromeLayoutPreviewStroke); }

    // ── Toolbox ──────────────────────────────────────────────────────────
    public static ToolboxTileSize():    number          { return DiagramSettings.num(DiagramSettingKey.ToolboxTileSize); }
    public static ToolboxPreviewFill(): SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.ToolboxPreviewFill); }

    // ── Rulers ───────────────────────────────────────────────────────────
    public static RulerThickness():      number          { return DiagramSettings.num(DiagramSettingKey.RulerThickness); }
    public static RulerTickMinSpacing(): number          { return DiagramSettings.num(DiagramSettingKey.RulerTickMinSpacing); }
    public static RulerFill():           SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.RulerFill); }
    public static RulerTickColor():      SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.RulerTickColor); }
    public static RulerHoverFill():      SolidColorBrush { return DiagramSettings.color(DiagramSettingKey.RulerHoverFill); }
}
