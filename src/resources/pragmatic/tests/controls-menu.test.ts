import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { MenuItem, MenuStrip, MenuButton } from '../../../framework/menu/menu-strip.js';
import { ContextMenu } from '../../../framework/menu/context-menu.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

// The MenuItem row chrome is applied imperatively (RowTemplate -> _rowRoot),
// exposed as the public visualChildren[0]; its named parts are fished out via
// FindName on that root (the popup Template is separate + detached).
class MenuRow
{
    public static Part(it: MenuItem, name: string): Border
    {
        const root = it.visualChildren[0];
        return root!.FindName(name) as Border;
    }
}

describe('Pragmatic menu family', () =>
{
    test('MenuItem/MenuStrip/MenuButton/ContextMenu resolve the Pragmatic style; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new MenuItem()), 'MenuItem Pragmatic');
        assert.ok(ControlHarness.IsPragmaticStyle(new MenuStrip()), 'MenuStrip Pragmatic');
        assert.ok(ControlHarness.IsPragmaticStyle(new MenuButton()), 'MenuButton Pragmatic');
        assert.ok(ControlHarness.IsPragmaticStyle(new ContextMenu()), 'ContextMenu Pragmatic');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new MenuItem()), 'Material MenuItem unchanged');
        ControlHarness.Reset();
    });

    test('menu row hover steps @Bg2', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const it = new MenuItem();
        it.Header = 'Open';
        it._setIsMouseOver(true);
        const row = MenuRow.Part(it, 'PART_Row');
        assert.equal((row.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'hovered row steps @Bg2');
        ControlHarness.Reset();
    });

    test('checked item keeps @SurfaceSelected while hovered (Review Focus: checked-over-hover)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const it = new MenuItem();
        it.Header = 'Bold';
        it.IsChecked = true;
        it._setIsMouseOver(true);
        const selected = MenuRow.Part(it, 'PART_Selected');
        assert.equal((selected.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('SurfaceSelected'), 'checked+hovered row keeps @SurfaceSelected on the dedicated layer');
        ControlHarness.Reset();
    });

    test('row label ink is @Fg1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const it = new MenuItem();
        it.Header = 'Open';
        const label = it.visualChildren[0]!.FindName('PART_Label') as { Foreground?: SolidColorBrush };
        assert.equal(label.Foreground!.Color.ToCss(), ControlHarness.TokenCss('Fg1'), 'row label ink is @Fg1');
        ControlHarness.Reset();
    });

    test('menu family resolves under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new MenuItem()), 'MenuItem dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new MenuStrip()), 'MenuStrip dark');
        const it = new MenuItem();
        it.Header = 'Bold';
        it.IsChecked = true;
        const selected = MenuRow.Part(it, 'PART_Selected');
        assert.equal((selected.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('SurfaceSelected'), 'dark checked row fills the dark @SurfaceSelected');
        ControlHarness.Reset();
    });
});
