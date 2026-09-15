import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application, Color, ResourceDictionary, ThemeManager } from '../../../runtime/index.js';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { ApplicationSettings } from '../../shell/services/application-settings-service.js';
import { DiagramSettings, DiagramSettingKey } from '../diagram-settings.js';
import { Material, MaterialLight, MaterialDark } from '../../../resources/material/material.js';

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

describe('DiagramSettings', () => {
    test('returns compiled-in defaults when no settings host is reachable', () => {
        Application.current = null;
        assert.equal(DiagramSettings.ShapeDefaultSize(), 80);
        assert.equal(DiagramSettings.ConnectorOrthogonalStub(), 20);
        assert.equal(DiagramSettings.HoverHaloOpacity(), 0.45);
        assert.equal(DiagramSettings.GuideThickness(), 1);
    });

    test('the new semantic colour tokens carry their compiled-in defaults', () => {
        Application.current = null;
        const hex = (b: SolidColorBrush): string => b.Color.ToHex().toLowerCase();
        // Functional connector-chrome palette.
        assert.equal(hex(DiagramSettings.ConnectorEndpointColor()), '#ff5722');
        assert.equal(hex(DiagramSettings.ConnectorHandleColor()),  '#ff9800');
        assert.equal(hex(DiagramSettings.ConnectorSegmentColor()), '#2196f3');
        assert.equal(hex(DiagramSettings.HandleFill()),            '#ffffff');
        // Content defaults.
        assert.equal(hex(DiagramSettings.ConnectorDefaultStroke()), '#475569');
        assert.equal(hex(DiagramSettings.ShapeLabelInk()),          '#000000');
        assert.equal(hex(DiagramSettings.TextNodeStroke()),         '#94a3b8');
        assert.equal(hex(DiagramSettings.NeutralInk()),             '#64748b');
    });

    test('self-publishes its definitions to the settings host on first resolve', () => {
        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        // Nothing contributed until the helper touches the service.
        assert.equal(settings.GetSetting(DiagramSettingKey.ShapeDefaultSize), undefined);

        // Any accessor read binds + contributes.
        assert.equal(DiagramSettings.ShapeDefaultSize(), 80);

        const s = settings.GetSetting(DiagramSettingKey.ShapeDefaultSize);
        assert.ok(s !== undefined, 'definition contributed');
        assert.equal(s!.Value, 80, 'seeded from the definition default');
        // Every catalogued key is present.
        assert.ok(settings.GetSetting(DiagramSettingKey.ConnectorLaneGap) !== undefined);
        assert.ok(settings.GetSetting(DiagramSettingKey.ChromeEndpointHandleSize) !== undefined);
    });

    test('an override in the settings host is reflected by the accessor', () => {
        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        // Bind first (contributes the definitions), then override.
        DiagramSettings.ConnectorOrthogonalStub();
        settings.Set(DiagramSettingKey.ConnectorOrthogonalStub, 40);
        assert.equal(DiagramSettings.ConnectorOrthogonalStub(), 40);
    });

    test('toolbox tile size defaults to 48 and honours an override', () => {
        Application.current = null;
        assert.equal(DiagramSettings.ToolboxTileSize(), 48);

        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        DiagramSettings.ToolboxTileSize();               // bind + contribute
        settings.Set(DiagramSettingKey.ToolboxTileSize, 64);
        assert.equal(DiagramSettings.ToolboxTileSize(), 64);
    });

    test('toolbox preview fill defaults to the #1976d2 brush', () => {
        Application.current = null;
        const fill = DiagramSettings.ToolboxPreviewFill();
        assert.ok(fill instanceof SolidColorBrush);
        assert.equal(fill.Color.ToHex().toLowerCase(), '#1976d2');
    });

    test('a Color override on the toolbox preview fill is reflected', () => {
        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        DiagramSettings.ToolboxPreviewFill();            // bind + contribute
        settings.Set(DiagramSettingKey.ToolboxPreviewFill, new SolidColorBrush(Color.FromHex('#ff0000')));
        assert.equal(DiagramSettings.ToolboxPreviewFill().Color.ToHex().toLowerCase(), '#ff0000');
    });

    test('shape default fill / stroke default to the #bfdbfe / #1976d2 brushes', () => {
        Application.current = null;
        const fill = DiagramSettings.ShapeDefaultFill();
        const stroke = DiagramSettings.ShapeDefaultStroke();
        assert.ok(fill instanceof SolidColorBrush);
        assert.ok(stroke instanceof SolidColorBrush);
        assert.equal(fill.Color.ToHex().toLowerCase(), '#bfdbfe');
        assert.equal(stroke.Color.ToHex().toLowerCase(), '#1976d2');
    });

    test('a Color override on the shape default fill is reflected', () => {
        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        DiagramSettings.ShapeDefaultFill();              // bind + contribute
        settings.Set(DiagramSettingKey.ShapeDefaultFill, new SolidColorBrush(Color.FromHex('#00ff00')));
        assert.equal(DiagramSettings.ShapeDefaultFill().Color.ToHex().toLowerCase(), '#00ff00');
    });

    test('OptimizeConnectorRouting defaults to true and honours an override', () => {
        Application.current = null;
        assert.equal(DiagramSettings.OptimizeConnectorRouting(), true);

        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        DiagramSettings.OptimizeConnectorRouting();       // bind + contribute
        // The boolean definition self-published as a Boolean-kind setting.
        assert.ok(settings.GetSetting(DiagramSettingKey.ConnectorOptimizeRouting) !== undefined);
        settings.Set(DiagramSettingKey.ConnectorOptimizeRouting, false);
        assert.equal(DiagramSettings.OptimizeConnectorRouting(), false);
    });

    test('exposes ruler + persistent-guide defaults', () => {
        Application.current = null;
        assert.equal(DiagramSettings.RulerThickness(), 20);
        assert.equal(DiagramSettings.RulerTickMinSpacing(), 60);
        assert.equal(DiagramSettings.GuideGrabTolerance(), 6);
        assert.equal(DiagramSettings.GuideCreateMargin(), 14);
        assert.equal(DiagramSettings.PersistentGuideThickness(), 1);
        assert.ok(DiagramSettings.PersistentGuideColor() instanceof SolidColorBrush);
        assert.ok(DiagramSettings.PersistentGuideSelectedColor() instanceof SolidColorBrush);
        assert.ok(DiagramSettings.PersistentGuidePreviewColor() instanceof SolidColorBrush);
        assert.ok(DiagramSettings.RulerFill() instanceof SolidColorBrush);
        assert.ok(DiagramSettings.RulerTickColor() instanceof SolidColorBrush);
        assert.ok(DiagramSettings.RulerHoverFill() instanceof SolidColorBrush);
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
            OnSurface:        '#112233',
            OnSurfaceVariant: '#445566',
            Surface:          '#778899',
            Primary:          '#aabbcc',
        });
        const hex = (b: SolidColorBrush): string => b.Color.ToHex().toLowerCase();
        assert.equal(hex(DiagramSettings.ShapeLabelInk()),          '#112233');
        assert.equal(hex(DiagramSettings.ConnectorDefaultStroke()), '#445566');
        assert.equal(hex(DiagramSettings.RulerFill()),              '#778899');
        assert.equal(hex(DiagramSettings.RulerTickColor()),         '#445566');
        // Ruler hover is a Primary WASH — the token re-tinted to α=41 (#29).
        assert.equal(hex(DiagramSettings.RulerHoverFill()),         '#aabbcc29');
    });

    test('a theme-linked colour re-resolves after the scheme token changes', () => {
        const app = appWithScheme({ OnSurface: '#111111' });
        assert.equal(DiagramSettings.ShapeLabelInk().Color.ToHex().toLowerCase(), '#111111');
        // Swap the token (a scheme swap merges a new dict last-added-wins).
        const dark = new ResourceDictionary();
        dark.Set('OnSurface', new SolidColorBrush(Color.FromHex('#eeeeee')));
        app.Resources.AddMergedDictionary(dark);
        assert.equal(DiagramSettings.ShapeLabelInk().Color.ToHex().toLowerCase(), '#eeeeee');
    });

    test('with a settings host but no override, a theme-linked colour still resolves the scheme token', () => {
        const app = appWithScheme({ OnSurface: '#123456' });
        app.Services.register(ApplicationSettings.Key, p => new ApplicationSettings(p));
        // Reading binds + contributes the definitions (seeding an UNDEFINED
        // default for the linked key), yet the accessor derives from the theme.
        assert.equal(DiagramSettings.ShapeLabelInk().Color.ToHex().toLowerCase(), '#123456');
    });

    test('a user override wins over the theme-linked default', () => {
        const app = appWithScheme({ OnSurface: '#123456' });
        app.Services.register(ApplicationSettings.Key, p => new ApplicationSettings(p));
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        DiagramSettings.ShapeLabelInk();                 // bind + contribute
        settings.Set(DiagramSettingKey.ShapeLabelInk, new SolidColorBrush(Color.FromHex('#ff0000')));
        assert.equal(DiagramSettings.ShapeLabelInk().Color.ToHex().toLowerCase(), '#ff0000');
    });

    test('Subscribe fires when a Diagram setting changes', () => {
        const app = appWithSettings();
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        // Ensure definitions are contributed and listeners wired.
        DiagramSettings.ShapeDefaultSize();

        let fired = 0;
        const unsub = DiagramSettings.Subscribe(() => { fired++; });
        settings.Set(DiagramSettingKey.ShapeDefaultSize, 120);
        assert.ok(fired >= 1, 'listener notified on change');

        unsub();
        settings.Set(DiagramSettingKey.ShapeDefaultSize, 64);
        assert.equal(fired, 1, 'no further notifications after unsubscribe');
    });

    // Regression: a light/dark scheme swap changes the tokens the theme-linked
    // colours resolve against (RulerFill = @Surface, …) but touches no Setting,
    // so without the ThemeManager hook Subscribe stayed silent and the rulers
    // kept the previous scheme's colours (a dark @Surface reads as a black strip
    // in light mode). The hook routes activation into the same change signal.
    test('Subscribe fires on a scheme swap so theme-linked colours repaint', () => {
        new Application();                                   // constructor sets Application.current
        if (ThemeManager.GetTheme(Material.instance.name) === undefined)
        {
            ThemeManager.RegisterTheme(Material.instance);
        }
        ThemeManager.ActivateTheme(Material.instance.name, { scheme: MaterialLight.name });

        let fired = 0;
        const unsub = DiagramSettings.Subscribe(() => { fired++; });
        ThemeManager.ActivateScheme(MaterialDark.name);
        assert.ok(fired >= 1, 'Subscribe notified on scheme swap (light → dark)');

        fired = 0;
        ThemeManager.ActivateScheme(MaterialLight.name);
        assert.ok(fired >= 1, 'Subscribe notified on scheme swap (dark → light)');

        unsub();
        fired = 0;
        ThemeManager.ActivateScheme(MaterialDark.name);
        assert.equal(fired, 0, 'no notification after unsubscribe');
    });
});
