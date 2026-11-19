import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    Panel,
    PropertyValueSource,
    SettingSourceKey,
} from '../../../runtime/index.js';
import { ApplicationSettings } from '../../shell/services/application-settings-service.js';
import { BoardSettings, BoardSettingKey } from '../board-settings.js';
import { Board } from '../board.js';

// Build a fresh Application per test with both service keys registered. This
// matches the shape EditorShell produces and avoids shared-state leakage across
// tests that use the shared initTestApp() singleton.
function appWithBoardSettings(): { app: Application; settings: ApplicationSettings }
{
    const app = new Application();
    app.Services.register(ApplicationSettings.Key, (p) => new ApplicationSettings(p));
    app.Services.register(SettingSourceKey, (p) => p.getRequired(ApplicationSettings.Key));
    const settings = app.Services.getRequired(ApplicationSettings.Key);
    // Contribute only the icon-size definitions needed for these tests.
    settings.Contribute(BoardSettings.Definitions().filter(
        d => d.Key === BoardSettingKey.DefaultIconWidth ||
             d.Key === BoardSettingKey.DefaultIconHeight,
    ));
    return { app, settings };
}

afterEach(() => { Application.current = null; });

describe('Board icon-size settings', () =>
{
    // ── 1. Resolves from setting ────────────────────────────────────────────────

    test('DefaultIconWidth defaults to 0 when no settings host is reachable', () =>
    {
        Application.current = null;
        const board = new Board();
        // No settings host — should read the DP default (0). The real 80
        // comes from the BoardSettings spec, which only applies when an
        // ISettingSource is reachable.
        const sub = board.PropertyChanged(Board.DefaultIconWidthKey).subscribe(() => { /* arm */ });
        try
        {
            assert.equal(Board.GetDefaultIconWidth(board), 0);
        }
        finally
        {
            sub.dispose();
        }
    });

    test('DefaultIconHeight defaults to 0 when no settings host is reachable', () =>
    {
        Application.current = null;
        const board = new Board();
        const sub = board.PropertyChanged(Board.DefaultIconHeightKey).subscribe(() => { /* arm */ });
        try
        {
            assert.equal(Board.GetDefaultIconHeight(board), 0);
        }
        finally
        {
            sub.dispose();
        }
    });

    test('DefaultIconWidth reflects the setting value after Set()', () =>
    {
        const { settings } = appWithBoardSettings();

        const board = new Board();
        const sub = board.PropertyChanged(Board.DefaultIconWidthKey).subscribe(() => { /* arm */ });
        try
        {
            void Board.GetDefaultIconWidth(board); // force EVD creation
            settings.Set(BoardSettingKey.DefaultIconWidth, 40);
            assert.equal(Board.GetDefaultIconWidth(board), 40);
            assert.equal(
                board.GetValueSource(Board.DefaultIconWidthKey),
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
        const { settings } = appWithBoardSettings();

        const board = new Board();
        const sub = board.PropertyChanged(Board.DefaultIconHeightKey).subscribe(() => { /* arm */ });
        try
        {
            void Board.GetDefaultIconHeight(board);
            settings.Set(BoardSettingKey.DefaultIconHeight, 40);
            assert.equal(Board.GetDefaultIconHeight(board), 40);
            assert.equal(
                board.GetValueSource(Board.DefaultIconHeightKey),
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
    // NOTE: A full Board visual tree is too heavy to spin up in a unit test
    // (requires a template host, HeadlessTarget render pass, etc.). Instead the
    // inheritance assertion uses a Panel ancestor and a Panel leaf: both are
    // Visual tree nodes; Panel.AddChild wires the same Attach / logical-parent
    // path that propagates MetaData.Inherits. This correctly exercises the
    // inheritance cascade for the cross-class attached property — the same
    // approach used in setting-value-precedence.test.ts (ProbeSurface extends
    // Panel with AddChild).

    test('DefaultIconWidth inherits to a child from a parent with a local override', () =>
    {
        appWithBoardSettings();

        const parent = new Panel();
        const child = new Panel();
        parent.AddChild(child);

        // Arm inheritance for the child.
        const sub = child.PropertyChanged(Board.DefaultIconWidthKey).subscribe(() => { /* arm */ });
        try
        {
            // Before any local override the child reads the setting value (80)
            // resolved via the settings host (the DP descriptor default is 0).
            assert.equal(child.get_property_value(Board.DefaultIconWidthKey), 80);

            // Set a local override on the parent — child must inherit 88.
            Board.SetDefaultIconWidth(parent, 88);
            assert.equal(child.get_property_value(Board.DefaultIconWidthKey), 88,
                'child must inherit the parent local-override value');
            assert.equal(
                child.GetValueSource(Board.DefaultIconWidthKey),
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
        appWithBoardSettings();

        const parent = new Panel();
        const child = new Panel();
        parent.AddChild(child);

        const sub = child.PropertyChanged(Board.DefaultIconHeightKey).subscribe(() => { /* arm */ });
        try
        {
            assert.equal(child.get_property_value(Board.DefaultIconHeightKey), 80);

            Board.SetDefaultIconHeight(parent, 72);
            assert.equal(child.get_property_value(Board.DefaultIconHeightKey), 72,
                'child must inherit the parent local-override value');
            assert.equal(
                child.GetValueSource(Board.DefaultIconHeightKey),
                PropertyValueSource.InheritedValue,
            );
        }
        finally
        {
            sub.dispose();
        }
    });

    // ── 3. Reacts: setting change fires PropertyChanged ─────────────────────────

    test('PropertyChanged fires on the Board when DefaultIconWidth setting changes', () =>
    {
        const { settings } = appWithBoardSettings();

        const board = new Board();
        let fired = 0;
        const sub = board.PropertyChanged(Board.DefaultIconWidthKey).subscribe(() => { fired++; });
        try
        {
            void Board.GetDefaultIconWidth(board); // arm the setting subscription
            settings.Set(BoardSettingKey.DefaultIconWidth, 50);
            assert.ok(fired >= 1, 'PropertyChanged must fire after Set(DefaultIconWidth)');
            assert.equal(Board.GetDefaultIconWidth(board), 50);
        }
        finally
        {
            sub.dispose();
        }
    });

    test('PropertyChanged fires on the Board when DefaultIconHeight setting changes', () =>
    {
        const { settings } = appWithBoardSettings();

        const board = new Board();
        let fired = 0;
        const sub = board.PropertyChanged(Board.DefaultIconHeightKey).subscribe(() => { fired++; });
        try
        {
            void Board.GetDefaultIconHeight(board);
            settings.Set(BoardSettingKey.DefaultIconHeight, 50);
            assert.ok(fired >= 1, 'PropertyChanged must fire after Set(DefaultIconHeight)');
            assert.equal(Board.GetDefaultIconHeight(board), 50);
        }
        finally
        {
            sub.dispose();
        }
    });
});
