import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application, Color, ResourceDictionary, ThemeManager } from '../../../runtime/index.js';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { ApplicationSettings } from '../../shell/services/application-settings-service.js';
import { BoardSettings, BoardSettingKey, SidePortsOptimizer } from '../board-settings.js';
import { SettingKind } from '@pragmatic-tech-ai/todl-runtime';
import { Pragmatic, PragmaticLight, PragmaticDark } from '../../../resources/pragmatic/pragmatic.js';

// Build an Application with ApplicationSettings registered at the ROOT — the
// same shape Plexus / EditorShell produce, and where the static helper resolves
// it (Application.current.Services).
function appWithSettings(): Application
{
    const app = new Application();
    app.Services.register(ApplicationSettings.Key, p => new ApplicationSettings(p));
    return app;
}

afterEach(() => { Application.current = null; });

describe('BoardSettings', () => {
    test('returns compiled-in defaults when no settings host is reachable', () => {
        Application.current = null;
        assert.equal(BoardSettings.ShapeDefaultSize(), 80);
        assert.equal(BoardSettings.ConnectorOrthogonalStub(), 20);
        assert.equal(BoardSettings.HoverHaloOpacity(), 0.45);
        assert.equal(BoardSettings.GuideThickness(), 1);
    });

    test('the new semantic colour tokens carry their compiled-in defaults', () => {
        Application.current = null;
        const hex = (b: SolidColorBrush): string => b.Color.ToHex().toLowerCase();
        // Functional connector-chrome palette.
        assert.equal(hex(BoardSettings.ConnectorEndpointColor()), '#ff5722');
        assert.equal(hex(BoardSettings.ConnectorHandleColor()),  '#ff9800');
        assert.equal(hex(BoardSettings.ConnectorSegmentColor()), '#2196f3');
        assert.equal(hex(BoardSettings.HandleFill()),            '#ffffff');
        // Content defaults.
        assert.equal(hex(BoardSettings.ConnectorDefaultStroke()), '#475569');
        assert.equal(hex(BoardSettings.ShapeLabelInk()),          '#000000');
        assert.equal(hex(BoardSettings.TextNodeStroke()),         '#94a3b8');
        assert.equal(hex(BoardSettings.NeutralInk()),             '#64748b');
    });

    test('self-publishes its definitions to the settings host on first resolve', () => {
        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        // Nothing contributed until the helper touches the service.
        assert.equal(settings.GetSetting(BoardSettingKey.ShapeDefaultSize), undefined);

        // Any accessor read binds + contributes.
        assert.equal(BoardSettings.ShapeDefaultSize(), 80);

        const s = settings.GetSetting(BoardSettingKey.ShapeDefaultSize);
        assert.ok(s !== undefined, 'definition contributed');
        assert.equal(s!.Value, 80, 'seeded from the definition default');
        // Every catalogued key is present.
        assert.ok(settings.GetSetting(BoardSettingKey.ConnectorLaneGap) !== undefined);
        assert.ok(settings.GetSetting(BoardSettingKey.ChromeEndpointHandleSize) !== undefined);
    });

    test('an override in the settings host is reflected by the accessor', () => {
        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        // Bind first (contributes the definitions), then override.
        BoardSettings.ConnectorOrthogonalStub();
        settings.Set(BoardSettingKey.ConnectorOrthogonalStub, 40);
        assert.equal(BoardSettings.ConnectorOrthogonalStub(), 40);
    });

    test('toolbox tile size defaults to 48 and honours an override', () => {
        Application.current = null;
        assert.equal(BoardSettings.ToolboxTileSize(), 48);

        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        BoardSettings.ToolboxTileSize();               // bind + contribute
        settings.Set(BoardSettingKey.ToolboxTileSize, 64);
        assert.equal(BoardSettings.ToolboxTileSize(), 64);
    });

    test('toolbox preview fill defaults to the #1976d2 brush', () => {
        Application.current = null;
        const fill = BoardSettings.ToolboxPreviewFill();
        assert.ok(fill instanceof SolidColorBrush);
        assert.equal(fill.Color.ToHex().toLowerCase(), '#1976d2');
    });

    test('a Color override on the toolbox preview fill is reflected', () => {
        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        BoardSettings.ToolboxPreviewFill();            // bind + contribute
        settings.Set(BoardSettingKey.ToolboxPreviewFill, new SolidColorBrush(Color.FromHex('#ff0000')));
        assert.equal(BoardSettings.ToolboxPreviewFill().Color.ToHex().toLowerCase(), '#ff0000');
    });

    test('shape default fill / stroke default to the #bfdbfe / #1976d2 brushes', () => {
        Application.current = null;
        const fill = BoardSettings.ShapeDefaultFill();
        const stroke = BoardSettings.ShapeDefaultStroke();
        assert.ok(fill instanceof SolidColorBrush);
        assert.ok(stroke instanceof SolidColorBrush);
        assert.equal(fill.Color.ToHex().toLowerCase(), '#bfdbfe');
        assert.equal(stroke.Color.ToHex().toLowerCase(), '#1976d2');
    });

    test('a Color override on the shape default fill is reflected', () => {
        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        BoardSettings.ShapeDefaultFill();              // bind + contribute
        settings.Set(BoardSettingKey.ShapeDefaultFill, new SolidColorBrush(Color.FromHex('#00ff00')));
        assert.equal(BoardSettings.ShapeDefaultFill().Color.ToHex().toLowerCase(), '#00ff00');
    });

    test('SidePortsOptimizer defaults to Optimized and honours an override', () => {
        Application.current = null;
        assert.equal(BoardSettings.SidePortsOptimizer(), SidePortsOptimizer.Optimized);

        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        BoardSettings.SidePortsOptimizer();             // bind + contribute
        assert.ok(settings.GetSetting(BoardSettingKey.ConnectorSidePortsOptimizer) !== undefined);
        settings.Set(BoardSettingKey.ConnectorSidePortsOptimizer, SidePortsOptimizer.BruteForce);
        assert.equal(BoardSettings.SidePortsOptimizer(), SidePortsOptimizer.BruteForce);
    });

    test('the side-ports optimizer is published as a Choice with both options', () => {
        const def = BoardSettings.Definitions()
            .find(d => d.Key === BoardSettingKey.ConnectorSidePortsOptimizer);
        assert.ok(def !== undefined, 'definition present');
        assert.equal(def!.Kind, SettingKind.Choice);
        assert.equal(def!.Default, SidePortsOptimizer.Optimized);
        assert.equal(def!.Choices?.Count, 2);
        assert.equal(def!.Choices?.Get(0), SidePortsOptimizer.Optimized);
        assert.equal(def!.Choices?.Get(1), SidePortsOptimizer.BruteForce);
    });

    test('an unrecognised persisted optimizer value falls back to Optimized', () => {
        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        BoardSettings.SidePortsOptimizer();             // bind + contribute
        settings.Set(BoardSettingKey.ConnectorSidePortsOptimizer, 'nonsense');
        assert.equal(BoardSettings.SidePortsOptimizer(), SidePortsOptimizer.Optimized);
    });

    test('exposes ruler + persistent-guide defaults', () => {
        Application.current = null;
        assert.equal(BoardSettings.RulerThickness(), 20);
        assert.equal(BoardSettings.RulerTickMinSpacing(), 60);
        assert.equal(BoardSettings.GuideGrabTolerance(), 6);
        assert.equal(BoardSettings.GuideCreateMargin(), 14);
        assert.equal(BoardSettings.PersistentGuideThickness(), 1);
        assert.ok(BoardSettings.PersistentGuideColor() instanceof SolidColorBrush);
        assert.ok(BoardSettings.PersistentGuideSelectedColor() instanceof SolidColorBrush);
        assert.ok(BoardSettings.PersistentGuidePreviewColor() instanceof SolidColorBrush);
        assert.ok(BoardSettings.RulerFill() instanceof SolidColorBrush);
        assert.ok(BoardSettings.RulerTickColor() instanceof SolidColorBrush);
        assert.ok(BoardSettings.RulerHoverFill() instanceof SolidColorBrush);
    });

    // ── Theme-linked colour defaults ──────────────────────────────────
    // Merge a bare token dict into Application.Resources to stand in for an
    // active scheme (themeBrush resolves through exactly this path).
    function appWithScheme(tokens: Record<string, string>): Application
    {
        const app = new Application();
        const dict = new ResourceDictionary();
        for (const [k, hex] of Object.entries(tokens))
        {
            dict.Set(k, new SolidColorBrush(Color.FromHex(hex)));
        }
        app.Resources.AddMergedDictionary(dict);
        return app;
    }

    test('theme-linked colours resolve the active scheme token when unoverridden', () => {
        appWithScheme({
            Ink:        '#112233',
            InkVariant: '#445566',
            SurfaceBg:          '#778899',
            AccentInk:          '#aabbcc',
        });
        const hex = (b: SolidColorBrush): string => b.Color.ToHex().toLowerCase();
        assert.equal(hex(BoardSettings.ShapeLabelInk()),          '#112233');
        assert.equal(hex(BoardSettings.ConnectorDefaultStroke()), '#445566');
        assert.equal(hex(BoardSettings.RulerFill()),              '#778899');
        assert.equal(hex(BoardSettings.RulerTickColor()),         '#445566');
        // Ruler hover is a AccentInk WASH — the token re-tinted to α=41 (#29).
        assert.equal(hex(BoardSettings.RulerHoverFill()),         '#aabbcc29');
    });

    test('a theme-linked colour re-resolves after the scheme token changes', () => {
        const app = appWithScheme({ Ink: '#111111' });
        assert.equal(BoardSettings.ShapeLabelInk().Color.ToHex().toLowerCase(), '#111111');
        // Swap the token (a scheme swap merges a new dict last-added-wins).
        const dark = new ResourceDictionary();
        dark.Set('Ink', new SolidColorBrush(Color.FromHex('#eeeeee')));
        app.Resources.AddMergedDictionary(dark);
        assert.equal(BoardSettings.ShapeLabelInk().Color.ToHex().toLowerCase(), '#eeeeee');
    });

    test('with a settings host but no override, a theme-linked colour still resolves the scheme token', () => {
        const app = appWithScheme({ Ink: '#123456' });
        app.Services.register(ApplicationSettings.Key, p => new ApplicationSettings(p));
        // Reading binds + contributes the definitions (seeding an UNDEFINED
        // default for the linked key), yet the accessor derives from the theme.
        assert.equal(BoardSettings.ShapeLabelInk().Color.ToHex().toLowerCase(), '#123456');
    });

    test('a user override wins over the theme-linked default', () => {
        const app = appWithScheme({ Ink: '#123456' });
        app.Services.register(ApplicationSettings.Key, p => new ApplicationSettings(p));
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        BoardSettings.ShapeLabelInk();                 // bind + contribute
        settings.Set(BoardSettingKey.ShapeLabelInk, new SolidColorBrush(Color.FromHex('#ff0000')));
        assert.equal(BoardSettings.ShapeLabelInk().Color.ToHex().toLowerCase(), '#ff0000');
    });

    test('Subscribe fires when a Board setting changes', () => {
        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        // Ensure definitions are contributed and listeners wired.
        BoardSettings.ShapeDefaultSize();

        let fired = 0;
        const unsub = BoardSettings.Subscribe(() => { fired++; });
        settings.Set(BoardSettingKey.ShapeDefaultSize, 120);
        assert.ok(fired >= 1, 'listener notified on change');

        unsub();
        settings.Set(BoardSettingKey.ShapeDefaultSize, 64);
        assert.equal(fired, 1, 'no further notifications after unsubscribe');
    });

    // Regression: a light/dark scheme swap changes the tokens the theme-linked
    // colours resolve against (RulerFill = @SurfaceBg, …) but touches no Setting,
    // so without the ThemeManager hook Subscribe stayed silent and the rulers
    // kept the previous scheme's colours (a dark @SurfaceBg reads as a black strip
    // in light mode). The hook routes activation into the same change signal.
    test('Subscribe fires on a scheme swap so theme-linked colours repaint', () => {
        new Application();                                   // constructor sets Application.current
        if (ThemeManager.GetTheme(Pragmatic.instance.name) === undefined)
        {
            ThemeManager.RegisterTheme(Pragmatic.instance);
        }
        ThemeManager.ActivateTheme(Pragmatic.instance.name, { scheme: PragmaticLight.name });

        let fired = 0;
        const unsub = BoardSettings.Subscribe(() => { fired++; });
        ThemeManager.ActivateScheme(PragmaticDark.name);
        assert.ok(fired >= 1, 'Subscribe notified on scheme swap (light → dark)');

        fired = 0;
        ThemeManager.ActivateScheme(PragmaticLight.name);
        assert.ok(fired >= 1, 'Subscribe notified on scheme swap (dark → light)');

        unsub();
        fired = 0;
        ThemeManager.ActivateScheme(PragmaticDark.name);
        assert.equal(fired, 0, 'no notification after unsubscribe');
    });
});
