import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { TextBlock } from '../../../basic/text-block.js';
import { NavigationItem, NavigationRail, NavigationBar } from '../../../framework/index.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic NavigationItem', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const item = new NavigationItem();
        assert.ok(ControlHarness.IsPragmaticStyle(item), 'NavigationItem uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const item = new NavigationItem();
        assert.ok(!ControlHarness.IsPragmaticStyle(item), 'Material NavigationItem keeps the Material style');
        ControlHarness.Reset();
    });

    test('rest state — both icon layers transparent', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const item = new NavigationItem();
        const container = item.GetTemplateChild('PART_IconContainer') as Border;
        const stateLayer = item.GetTemplateChild('PART_IconStateLayer') as Border;
        assert.equal((container.Fill as SolidColorBrush).Color.ToCss(), 'rgba(0,0,0,0)', 'PART_IconContainer transparent at rest');
        assert.equal((stateLayer.Fill as SolidColorBrush).Color.ToCss(), 'rgba(0,0,0,0)', 'PART_IconStateLayer transparent at rest');
        ControlHarness.Reset();
    });

    test('hover fills PART_IconContainer with @Bg2, PART_IconStateLayer stays transparent', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const item = new NavigationItem();
        item._setIsMouseOver(true);
        const container = item.GetTemplateChild('PART_IconContainer') as Border;
        const stateLayer = item.GetTemplateChild('PART_IconStateLayer') as Border;
        assert.equal((container.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'hover surface fills @Bg2');
        assert.equal((stateLayer.Fill as SolidColorBrush).Color.ToCss(), 'rgba(0,0,0,0)', 'state layer untouched by hover alone');
        ControlHarness.Reset();
    });

    test('selected fills PART_IconStateLayer with @SurfaceSelected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const item = new NavigationItem();
        item.IsSelected = true;
        const stateLayer = item.GetTemplateChild('PART_IconStateLayer') as Border;
        assert.equal((stateLayer.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('SurfaceSelected'), 'selected pill fills @SurfaceSelected');
        ControlHarness.Reset();
    });

    test('selected + concurrent hover — PART_IconStateLayer STILL @SurfaceSelected (dedicated layer survives by z-order)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const item = new NavigationItem();
        item.IsSelected = true;
        item._setIsMouseOver(true);
        const stateLayer = item.GetTemplateChild('PART_IconStateLayer') as Border;
        const container = item.GetTemplateChild('PART_IconContainer') as Border;
        assert.equal((stateLayer.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('SurfaceSelected'), 'selection survives a concurrent hover');
        assert.equal((container.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'the hover surface beneath still shows @Bg2');
        ControlHarness.Reset();
    });

    test('selected label ink flips to @BrandGreenInk', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const item = new NavigationItem();
        item.IsSelected = true;
        const label = item.GetTemplateChild('PART_LabelText') as TextBlock;
        assert.equal((label.Foreground as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('BrandGreenInk'), 'selected label paints @BrandGreenInk');
        ControlHarness.Reset();
    });

    test('no grey fallback under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new NavigationItem(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });

    test('resolves the Pragmatic style under PragmaticDark, selected pill uses the dark @SurfaceSelected', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        const item = new NavigationItem();
        assert.ok(ControlHarness.IsPragmaticStyle(item), 'NavigationItem uses the Pragmatic override style under dark');
        item.IsSelected = true;
        const stateLayer = item.GetTemplateChild('PART_IconStateLayer') as Border;
        assert.equal((stateLayer.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('SurfaceSelected'), 'dark selected pill fills the dark @SurfaceSelected');
        ControlHarness.Reset();
    });
});

describe('Pragmatic NavigationRail', () =>
{
    test('resolves the Pragmatic style under Pragmatic (light + dark), Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new NavigationRail()), 'NavigationRail resolves Pragmatic under light');
        ControlHarness.Reset();

        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new NavigationRail()), 'NavigationRail resolves Pragmatic under dark');
        ControlHarness.Reset();

        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new NavigationRail()), 'Material NavigationRail keeps the Material style');
        ControlHarness.Reset();
    });

    test('rail chrome fills @Bg1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const rail = new NavigationRail();
        const border = rail.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'rail surface fills @Bg1');
        ControlHarness.Reset();
    });

    test('no grey fallback under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new NavigationRail(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });
});

describe('Pragmatic NavigationBar', () =>
{
    test('resolves the Pragmatic style under Pragmatic (light + dark), Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new NavigationBar()), 'NavigationBar resolves Pragmatic under light');
        ControlHarness.Reset();

        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new NavigationBar()), 'NavigationBar resolves Pragmatic under dark');
        ControlHarness.Reset();

        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new NavigationBar()), 'Material NavigationBar keeps the Material style');
        ControlHarness.Reset();
    });

    test('bar chrome fills @Bg1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const bar = new NavigationBar();
        const border = bar.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'bar surface fills @Bg1');
        ControlHarness.Reset();
    });

    test('no grey fallback under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new NavigationBar(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });
});
