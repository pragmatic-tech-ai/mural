import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { IconButton } from '../../../framework/buttons/icon-button.js';
import { IconButtonToggle } from '../../../framework/buttons/icon-button-toggle.js';
import { FloatingActionButton, FabSize } from '../../../framework/buttons/fab.js';
import { PragmaticLight } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic IconButton', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new IconButton(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'IconButton uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new IconButton(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });

    test('Material is unaffected — an IconButton under Material keeps the Material style', () =>
    {
        const { control } = ControlHarness.Render(() => new IconButton(), { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material IconButton does NOT resolve the Pragmatic style');
        ControlHarness.Reset();
    });
});

describe('Pragmatic IconButtonToggle', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new IconButtonToggle(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'IconButtonToggle uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('checked state paints the selected surface (@SurfaceSelected)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const t = new IconButtonToggle();
            t.IsChecked = true;
            return t;
        }, { scheme: PragmaticLight });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        assert.ok(svg.includes(selected!), 'checked IconButtonToggle paints @SurfaceSelected');
        ControlHarness.Reset();
    });
});

describe('Pragmatic FloatingActionButton', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new FloatingActionButton(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'FAB uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('paints the primary action surface (@ActionPrimary)', () =>
    {
        const { svg } = ControlHarness.Render(() => new FloatingActionButton(), { scheme: PragmaticLight });
        const actionPrimary = ControlHarness.TokenCss('ActionPrimary');
        assert.equal(actionPrimary, 'rgb(34,130,77)');
        assert.ok(svg.includes(actionPrimary!), 'FAB paints @ActionPrimary');
        ControlHarness.Reset();
    });

    test('Small size still resolves the Pragmatic style', () =>
    {
        const { control } = ControlHarness.Render(() =>
        {
            const fab = new FloatingActionButton();
            fab.Size = FabSize.Small;
            return fab;
        }, { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Small FAB still resolves the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new FloatingActionButton(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });
});
