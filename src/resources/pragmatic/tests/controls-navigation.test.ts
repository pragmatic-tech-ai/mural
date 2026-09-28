import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { TextBlock } from '../../../basic/text-block.js';
import { NavigationItem, NavigationRail, NavigationBar } from '../../../framework/index.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';
import { Style } from '../../../runtime/index.js';
import { Shape } from '../../../basic/shapes/shape.js';

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


// ── ActivityBar rail variant (keyed) ─────────────────────────────────
//
// ActivityBarItem is a KEYED variant (x:key="ActivityBarItem", TargetType
// NavigationItem) the shell applies by key — a plain `new NavigationItem()`
// resolves the key-less default style, so the Wave-4 integration sweep
// never reaches it. These cases apply the keyed Pragmatic style the way
// the shell does and pin the VSCode-style rail affordances the whole-
// branch review flagged as untested: the selected accent bar
// (@ControlAccent) and the icon brighten (@Fg2 @ 0.55 at rest → @Fg1 @ 1
// on select or hover). PART_Accent and PART_Icon are separate elements, so
// a selected item that is also hovered keeps its accent — no trigger race.
class ActivityBarItemFixture
{
    private static readonly StyleKey = 'ActivityBarItem';

    // A NavigationItem wearing the keyed Pragmatic ActivityBarItem style,
    // its template applied so PART_Accent / PART_Icon are reachable. Must
    // run under an active Application (Activate/Render) so TryFindResource
    // resolves the key against the live Pragmatic dictionary.
    public static Make(): NavigationItem
    {
        const item = new NavigationItem();
        item.Style = item.TryFindResource(ActivityBarItemFixture.StyleKey) as Style;
        return item;
    }
}

describe('Pragmatic ActivityBarItem (keyed rail variant)', () =>
{
    test('the keyed ActivityBarItem style is the Pragmatic override under Pragmatic, a distinct style under Material', () =>
    {
        // Both themes key an ActivityBarItem (the Pragmatic fork overrides
        // Material's by key, last-merged-wins), so the discriminator is
        // identity, not presence. Compare with assert.ok on booleans — never
        // assert.equal against the resolved Style object, whose deep template
        // graph blows up node:test's failure formatter (array-buffer OOM).
        ControlHarness.Activate(PragmaticLight);
        const pragmaticStyle = new NavigationItem().TryFindResource('ActivityBarItem');
        assert.ok(pragmaticStyle !== undefined, 'Pragmatic resolves the keyed ActivityBarItem style');
        ControlHarness.Reset();

        ControlHarness.Activate(MaterialLight);
        const materialStyle = new NavigationItem().TryFindResource('ActivityBarItem');
        ControlHarness.Reset();

        assert.ok(pragmaticStyle !== materialStyle, 'the Pragmatic ActivityBarItem is a distinct override, not the Material style');
    });

    test('rest — accent bar transparent, icon dimmed to @Fg2 @ 0.55', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const item = ActivityBarItemFixture.Make();
        const accent = item.GetTemplateChild('PART_Accent') as Border;
        const icon = item.GetTemplateChild('PART_Icon') as Shape;
        assert.equal((accent.Fill as SolidColorBrush).Color.ToCss(), 'rgba(0,0,0,0)', 'accent bar hidden at rest');
        assert.equal((icon.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Fg2'), 'rest icon paints @Fg2');
        assert.equal(icon.Opacity, 0.55, 'rest icon dimmed to 0.55');
        ControlHarness.Reset();
    });

    test('selected — accent bar @ControlAccent, icon brightens to @Fg1 @ 1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const item = ActivityBarItemFixture.Make();
        item.IsSelected = true;
        const accent = item.GetTemplateChild('PART_Accent') as Border;
        const icon = item.GetTemplateChild('PART_Icon') as Shape;
        assert.equal((accent.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ControlAccent'), 'selected accent bar paints @ControlAccent');
        assert.equal((icon.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Fg1'), 'selected icon paints @Fg1');
        assert.equal(icon.Opacity, 1, 'selected icon is fully opaque');
        ControlHarness.Reset();
    });

    test('hover alone brightens the icon but leaves the accent bar hidden', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const item = ActivityBarItemFixture.Make();
        item._setIsMouseOver(true);
        const accent = item.GetTemplateChild('PART_Accent') as Border;
        const icon = item.GetTemplateChild('PART_Icon') as Shape;
        assert.equal((icon.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Fg1'), 'hover brightens the icon to @Fg1');
        assert.equal((accent.Fill as SolidColorBrush).Color.ToCss(), 'rgba(0,0,0,0)', 'hover alone does NOT reveal the selected accent bar');
        ControlHarness.Reset();
    });

    test('selected + concurrent hover — accent bar STILL @ControlAccent (dedicated element, no trigger race)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const item = ActivityBarItemFixture.Make();
        item.IsSelected = true;
        item._setIsMouseOver(true);
        const accent = item.GetTemplateChild('PART_Accent') as Border;
        assert.equal((accent.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ControlAccent'), 'the selection accent survives a concurrent hover');
        ControlHarness.Reset();
    });

    test('no grey fallback under Pragmatic (selected)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const item = ActivityBarItemFixture.Make();
            item.IsSelected = true;
            return item;
        }, { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every ActivityBar token resolves');
        ControlHarness.Reset();
    });

    test('resolves and accents under PragmaticDark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        const item = ActivityBarItemFixture.Make();
        item.IsSelected = true;
        const accent = item.GetTemplateChild('PART_Accent') as Border;
        assert.equal((accent.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ControlAccent'), 'dark selected accent paints the dark @ControlAccent');
        ControlHarness.Reset();
    });
});
