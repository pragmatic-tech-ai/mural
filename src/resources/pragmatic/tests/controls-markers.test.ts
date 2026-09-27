import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Chip } from '../../../framework/markers/chip.js';
import { Badge, BadgeVariant } from '../../../framework/markers/badge.js';
import { Divider } from '../../../framework/markers/divider.js';
import { Orientation } from '../../../basic/panels/orientation.js';
import { Border } from '../../../basic/border.js';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { PragmaticLight } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Chip', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new Chip(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Chip uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected — a Chip under Material keeps the Material style', () =>
    {
        const { control } = ControlHarness.Render(() => new Chip(), { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material Chip does NOT resolve the Pragmatic style');
        ControlHarness.Reset();
    });

    test('rest chip paints the @Border outline stroke', () =>
    {
        const { svg } = ControlHarness.Render(() => new Chip(), { scheme: PragmaticLight });
        const border = ControlHarness.TokenCss('Border');
        assert.equal(border, 'rgb(233,232,228)');
        assert.ok(svg.includes(`stroke="${border}"`), 'rest Chip paints @Border as a stroke');
        ControlHarness.Reset();
    });

    test('selected state fills @SurfaceSelected (#E2F3E9)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const c = new Chip();
            c.IsChecked = true;
            return c;
        }, { scheme: PragmaticLight });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        assert.equal(selected, 'rgb(226,243,233)');
        assert.ok(svg.includes(selected!), 'selected Chip paints @SurfaceSelected');
        ControlHarness.Reset();
    });

    test('selected + hovered keeps the selected fill — hover must not erase it', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const c = new Chip();
            c.IsChecked = true;
            c._setIsMouseOver(true);
            return c;
        }, { scheme: PragmaticLight });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        const hover = ControlHarness.TokenCss('Bg2');
        const selectedIndex = svg.indexOf(selected!);
        const hoverIndex = svg.indexOf(hover!);
        assert.notEqual(selectedIndex, -1, 'selected + hovered Chip still paints @SurfaceSelected');
        assert.notEqual(hoverIndex, -1, 'the hover surface (@Bg2) still paints underneath — the ghost chip layer');
        assert.ok(selectedIndex > hoverIndex,
            'the @SurfaceSelected PART_Selected layer must paint AFTER (on top of, in SVG document order) the ' +
            '@Bg2 hover layer, so the selected cue visually wins while hovered');
        ControlHarness.Reset();
    });

    test('focus paints the ring stroke (@BorderFocus), distinct from the chip border', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const c = new Chip();
            c._setIsFocused(true);
            return c;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(34,130,77)');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused Chip paints the @BorderFocus ring stroke');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new Chip(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });
});

describe('Pragmatic Badge', () =>
{
    // NB: every render-through-SVG check below drives the Dot variant, not
    // the (default) Numeric one. Numeric's PART_Pill unconditionally nests
    // a `Text = $$Count` TextBlock, and rendering ANY TextBlock bound to
    // Count (a `number` DP) trips a pre-existing, cross-theme rendering gap
    // — SvgDrawingContext.escapeXmlText expects a string and there is no
    // numeric→string converter path for a `$$` TemplateBinding in the
    // compiler (see task-6-report.md). Confirmed pre-existing and NOT
    // introduced by this fork: it reproduces identically against Material's
    // own DefaultNumericBadge, which used the same `Text = $Count` shape
    // and had zero test coverage before this file. The Numeric fill test
    // below reads PART_Pill.Fill directly instead of rendering, so it can
    // still verify the Pragmatic template's colour without hitting the gap.
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() =>
        {
            const b = new Badge();
            b.Variant = BadgeVariant.Dot;
            return b;
        }, { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Badge uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected — a Badge under Material keeps the Material style', () =>
    {
        const { control } = ControlHarness.Render(() =>
        {
            const b = new Badge();
            b.Variant = BadgeVariant.Dot;
            return b;
        }, { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material Badge does NOT resolve the Pragmatic style');
        ControlHarness.Reset();
    });

    test('numeric badge fills @StateDanger', () =>
    {
        // Resolution-only (no render — see the describe-level note above):
        // activate the theme, construct the (default Numeric-variant)
        // Badge, and read PART_Pill's resolved Fill straight off the
        // template child rather than through SvgDrawingContext.
        ControlHarness.Activate(PragmaticLight);
        const badge = new Badge();
        const pill = badge.GetTemplateChild('PART_Pill') as Border;
        const danger = ControlHarness.TokenCss('StateDanger');
        assert.equal(danger, 'rgb(194,69,50)');
        assert.ok(pill.Fill instanceof SolidColorBrush, 'PART_Pill resolves a concrete fill brush');
        assert.equal((pill.Fill as SolidColorBrush).Color.ToCss(), danger, 'numeric Badge paints @StateDanger');
        ControlHarness.Reset();
    });

    test('dot badge fills @StateDanger', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new Badge();
            b.Variant = BadgeVariant.Dot;
            return b;
        }, { scheme: PragmaticLight });
        const danger = ControlHarness.TokenCss('StateDanger');
        assert.ok(svg.includes(danger!), 'dot Badge paints @StateDanger');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new Badge();
            b.Variant = BadgeVariant.Dot;
            return b;
        }, { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });
});

describe('Pragmatic Divider', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new Divider(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Divider uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected — a Divider under Material keeps the Material style', () =>
    {
        const { control } = ControlHarness.Render(() => new Divider(), { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material Divider does NOT resolve the Pragmatic style');
        ControlHarness.Reset();
    });

    test('horizontal rule paints @Border as a stroke', () =>
    {
        const { svg } = ControlHarness.Render(() => new Divider(), { scheme: PragmaticLight });
        const border = ControlHarness.TokenCss('Border');
        assert.equal(border, 'rgb(233,232,228)');
        assert.ok(svg.includes(`stroke="${border}"`), 'horizontal Divider paints @Border as a stroke');
        ControlHarness.Reset();
    });

    test('vertical rule paints @Border as a stroke', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const d = new Divider();
            d.Orientation = Orientation.Vertical;
            return d;
        }, { scheme: PragmaticLight });
        const border = ControlHarness.TokenCss('Border');
        assert.ok(svg.includes(`stroke="${border}"`), 'vertical Divider paints @Border as a stroke');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new Divider(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });
});
