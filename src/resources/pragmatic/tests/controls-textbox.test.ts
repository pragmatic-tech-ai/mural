import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TextBox, TextBoxVariant } from '../../../basic/text-box.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic TextBox (Outlined)', () =>
{
    // Resolution-only (Activate, not Render) — deliberately does NOT paint.
    // Before this fork is wired, an un-forked TextBox under Pragmatic still
    // resolves MATERIAL's Style, whose ControlTemplate/Style reference M3
    // tokens (@Outline, @Primary, @ShapeExtraSmall, @ListRowHeight*, …) that
    // the Pragmatic scheme never defines. Actually PAINTING that
    // combination (HeadlessTarget + SvgDrawingContext) hangs the process
    // indefinitely — confirmed empirically pre-fork: CPU-pegged, no
    // pending timer/handle, only killable externally, so it is a
    // DynamicResource retry-loop against a permanently-missing token, not a
    // slow render. A resolution-only check (TryFindResource, no layout/
    // paint) proves the same fact — Pragmatic style used or not — without
    // ever entering that path, both before AND after wiring.
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const control = new TextBox();
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'TextBox uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('rest state paints the outlined border (@BorderStrong)', () =>
    {
        const { svg } = ControlHarness.Render(() => new TextBox(), { scheme: PragmaticLight });
        const borderStrong = ControlHarness.TokenCss('BorderStrong');
        assert.ok(svg.includes(borderStrong!), 'Outlined TextBox paints @BorderStrong at rest');
        ControlHarness.Reset();
    });

    test('focus swaps the border to @BorderFocus (#22824D)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const tb = new TextBox();
            tb._setIsFocused(true);
            return tb;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(34,130,77)');
        // Stroke-attribute form, not a bare substring check: @ActionPrimary
        // resolves to the SAME rgb() as @BorderFocus under PragmaticLight, so
        // a loose `svg.includes(borderFocus)` would pass even if the colour
        // painted as a fill (or the tuple->Thickness compiler bug silently
        // dropped the stroke entirely — see the template's GOTCHA comment).
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused Outlined TextBox paints @BorderFocus as a border stroke');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with no grey fallback and paints the dark @Bg1 surface', () =>
    {
        // Unfocused, deliberately — no Pen is involved on this path.
        // PART_Border.Fill = @Bg1 is a direct assignment on a Border
        // created fresh for THIS render, so its DynamicResourceBinding
        // wires to whichever Application is current right now. See the
        // test below for the focus-border path, which does NOT share that
        // property (it goes through a Pen-wrapped Stroke).
        const { svg } = ControlHarness.Render(() => new TextBox(), { scheme: PragmaticDark });
        const bg1 = ControlHarness.TokenCss('Bg1');
        assert.equal(bg1, 'rgb(20,19,18)', '@Bg1 under PragmaticDark is #141312');
        assert.ok(svg.includes(bg1!), 'Outlined TextBox paints @Bg1 under PragmaticDark');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral fallback — every token resolves under PragmaticDark');
        ControlHarness.Reset();
    });

    // Regression test for Wave-1 follow-up (E) — see the equivalent Button
    // test's comment (controls-buttons.test.ts) for the full root-cause
    // writeup: a `Pen [ Brush = @Token ]` trigger value is a single shared
    // instance built once at template-construction time, and its
    // DynamicResourceBinding used to never re-wire when Application.current
    // was swapped to a different instance (ControlHarness does this between
    // tests). Confirmed harmless for a real single-Application runtime
    // Light<->Dark toggle. Fixed in dynamic-resource.ts.
    test('focus border paints @BorderFocus under Dark after a Light render', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const tb = new TextBox();
            tb._setIsFocused(true);
            return tb;
        }, { scheme: PragmaticDark });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(46,168,98)', '@BorderFocus under PragmaticDark is #2EA862');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused Outlined TextBox paints the dark @BorderFocus stroke');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral fallback — every token resolves under PragmaticDark');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new TextBox(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });

});

describe('Pragmatic TextBox (Filled)', () =>
{
    test('fills with @Bg2', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const tb = new TextBox();
            tb.Variant = TextBoxVariant.Filled;
            return tb;
        }, { scheme: PragmaticLight });
        const bg2 = ControlHarness.TokenCss('Bg2');
        assert.ok(svg.includes(bg2!), 'Filled TextBox paints @Bg2');
        ControlHarness.Reset();
    });

    test('focus flips the underline to @BorderFocus (#22824D)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const tb = new TextBox();
            tb.Variant = TextBoxVariant.Filled;
            tb._setIsFocused(true);
            return tb;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(34,130,77)');
        // Stroke-attribute form — see the Outlined focus test above for why
        // a bare substring check is too loose here (@ActionPrimary shares
        // the same rgb() as @BorderFocus under PragmaticLight).
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused Filled TextBox underline paints @BorderFocus as a stroke');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const tb = new TextBox();
            tb.Variant = TextBoxVariant.Filled;
            return tb;
        }, { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });
});

describe('Pragmatic TextBox (Plain)', () =>
{
    test('resolves the Pragmatic style and paints no chrome fallback', () =>
    {
        const { control, svg } = ControlHarness.Render(() =>
        {
            const tb = new TextBox();
            tb.Variant = TextBoxVariant.Plain;
            return tb;
        }, { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Plain TextBox still uses the Pragmatic override style');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });
});
