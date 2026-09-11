import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    Panel,
    PropertyValueSource,
    SettingSourceKey,
} from '../../../runtime/index.js';
import { ApplicationSettings } from '../../shell/services/application-settings-service.js';
import { DiagramSettings, DiagramSettingKey } from '../diagram-settings.js';
import { Diagram } from '../diagram.js';

// Build a fresh Application per test with both service keys registered. This
// matches the shape EditorShell produces and avoids shared-state leakage across
// tests that use the shared initTestApp() singleton.
function appWithDiagramSettings(): { app: Application; settings: ApplicationSettings }
{
    const app = new Application();
    app.Services.register(ApplicationSettings.Key, (p) => new ApplicationSettings(p));
    app.Services.register(SettingSourceKey, (p) => p.getRequired(ApplicationSettings.Key));
    const settings = app.Services.getRequired(ApplicationSettings.Key);
    // Contribute only the icon-size definitions needed for these tests.
    settings.Contribute(DiagramSettings.Definitions().filter(
        d => d.Key === DiagramSettingKey.DefaultIconWidth ||
             d.Key === DiagramSettingKey.DefaultIconHeight,
    ));
    return { app, settings };
}

afterEach(() => { Application.current = null; });

describe('Diagram icon-size settings', () =>
{
    // ── 1. Resolves from setting ────────────────────────────────────────────────

    test('DefaultIconWidth defaults to 0 when no settings host is reachable', () =>
    {
        Application.current = null;
        const diagram = new Diagram();
        // No settings host — should read the DP default (0). The real 80
        // comes from the DiagramSettings spec, which only applies when an
        // ISettingSource is reachable.
        const sub = diagram.PropertyChanged(Diagram.DefaultIconWidthKey).subscribe(() => { /* arm */ });
        try
        {
            assert.equal(Diagram.GetDefaultIconWidth(diagram), 0);
        }
        finally
        {
            sub.dispose();
        }
    });

    test('DefaultIconHeight defaults to 0 when no settings host is reachable', () =>
    {
        Application.current = null;
        const diagram = new Diagram();
        const sub = diagram.PropertyChanged(Diagram.DefaultIconHeightKey).subscribe(() => { /* arm */ });
        try
        {
            assert.equal(Diagram.GetDefaultIconHeight(diagram), 0);
        }
        finally
        {
            sub.dispose();
        }
    });

    test('DefaultIconWidth reflects the setting value after Set()', () =>
    {
        const { settings } = appWithDiagramSettings();

        const diagram = new Diagram();
        const sub = diagram.PropertyChanged(Diagram.DefaultIconWidthKey).subscribe(() => { /* arm */ });
        try
        {
            void Diagram.GetDefaultIconWidth(diagram); // force EVD creation
            settings.Set(DiagramSettingKey.DefaultIconWidth, 40);
            assert.equal(Diagram.GetDefaultIconWidth(diagram), 40);
            assert.equal(
                diagram.GetValueSource(Diagram.DefaultIconWidthKey),
                PropertyValueSource.SettingValue,
                'no local override → source must be SettingValue',
            );
        }
        finally
        {
            sub.dispose();
        }
    });

    test('DefaultIconHeight reflects the setting value after Set()', () =>
    {
        const { settings } = appWithDiagramSettings();

        const diagram = new Diagram();
        const sub = diagram.PropertyChanged(Diagram.DefaultIconHeightKey).subscribe(() => { /* arm */ });
        try
        {
            void Diagram.GetDefaultIconHeight(diagram);
            settings.Set(DiagramSettingKey.DefaultIconHeight, 40);
            assert.equal(Diagram.GetDefaultIconHeight(diagram), 40);
            assert.equal(
                diagram.GetValueSource(Diagram.DefaultIconHeightKey),
                PropertyValueSource.SettingValue,
            );
        }
        finally
        {
            sub.dispose();
        }
    });

    // ── 2. Inherits to a child (simplified ancestor/child via Panel.AddChild) ────
    //
    // NOTE: A full Diagram visual tree is too heavy to spin up in a unit test
    // (requires a template host, HeadlessTarget render pass, etc.). Instead the
    // inheritance assertion uses a Panel ancestor and a Panel leaf: both are
    // Visual tree nodes; Panel.AddChild wires the same Attach / logical-parent
    // path that propagates MetaData.Inherits. This correctly exercises the
    // inheritance cascade for the cross-class attached property — the same
    // approach used in setting-value-precedence.test.ts (ProbeSurface extends
    // Panel with AddChild).

    test('DefaultIconWidth inherits to a child from a parent with a local override', () =>
    {
        appWithDiagramSettings();

        const parent = new Panel();
        const child = new Panel();
        parent.AddChild(child);

        // Arm inheritance for the child.
        const sub = child.PropertyChanged(Diagram.DefaultIconWidthKey).subscribe(() => { /* arm */ });
        try
        {
            // Before any local override the child reads the setting value (80)
            // resolved via the settings host (the DP descriptor default is 0).
            assert.equal(child.get_property_value(Diagram.DefaultIconWidthKey), 80);

            // Set a local override on the parent — child must inherit 88.
            Diagram.SetDefaultIconWidth(parent, 88);
            assert.equal(child.get_property_value(Diagram.DefaultIconWidthKey), 88,
                'child must inherit the parent local-override value');
            assert.equal(
                child.GetValueSource(Diagram.DefaultIconWidthKey),
                PropertyValueSource.InheritedValue,
                'child source must be InheritedValue when inheriting from parent',
            );
        }
        finally
        {
            sub.dispose();
        }
    });

    test('DefaultIconHeight inherits to a child from a parent with a local override', () =>
    {
        appWithDiagramSettings();

        const parent = new Panel();
        const child = new Panel();
        parent.AddChild(child);

        const sub = child.PropertyChanged(Diagram.DefaultIconHeightKey).subscribe(() => { /* arm */ });
        try
        {
            assert.equal(child.get_property_value(Diagram.DefaultIconHeightKey), 80);

            Diagram.SetDefaultIconHeight(parent, 72);
            assert.equal(child.get_property_value(Diagram.DefaultIconHeightKey), 72,
                'child must inherit the parent local-override value');
            assert.equal(
                child.GetValueSource(Diagram.DefaultIconHeightKey),
                PropertyValueSource.InheritedValue,
            );
        }
        finally
        {
            sub.dispose();
        }
    });

    // ── 3. Reacts: setting change fires PropertyChanged ─────────────────────────

    test('PropertyChanged fires on the Diagram when DefaultIconWidth setting changes', () =>
    {
        const { settings } = appWithDiagramSettings();

        const diagram = new Diagram();
        let fired = 0;
        const sub = diagram.PropertyChanged(Diagram.DefaultIconWidthKey).subscribe(() => { fired++; });
        try
        {
            void Diagram.GetDefaultIconWidth(diagram); // arm the setting subscription
            settings.Set(DiagramSettingKey.DefaultIconWidth, 50);
            assert.ok(fired >= 1, 'PropertyChanged must fire after Set(DefaultIconWidth)');
            assert.equal(Diagram.GetDefaultIconWidth(diagram), 50);
        }
        finally
        {
            sub.dispose();
        }
    });

    test('PropertyChanged fires on the Diagram when DefaultIconHeight setting changes', () =>
    {
        const { settings } = appWithDiagramSettings();

        const diagram = new Diagram();
        let fired = 0;
        const sub = diagram.PropertyChanged(Diagram.DefaultIconHeightKey).subscribe(() => { fired++; });
        try
        {
            void Diagram.GetDefaultIconHeight(diagram);
            settings.Set(DiagramSettingKey.DefaultIconHeight, 50);
            assert.ok(fired >= 1, 'PropertyChanged must fire after Set(DefaultIconHeight)');
            assert.equal(Diagram.GetDefaultIconHeight(diagram), 50);
        }
        finally
        {
            sub.dispose();
        }
    });
});
