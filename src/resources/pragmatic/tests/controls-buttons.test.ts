import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { Button, ButtonVariant } from '../../../framework/buttons/button.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Button', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new Button(), { scheme: PragmaticLight });
        // The Pragmatic primary template fills with @ActionPrimary; the
        // resolved implicit style is the Pragmatic one (identity).
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Button uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('legacy Variant = Filled renders the Primary look (@ActionPrimary)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new Button();
            b.Variant = ButtonVariant.Filled;
            return b;
        }, { scheme: PragmaticLight });
        // #22824D — the SvgDrawingContext serialises brushes as rgb().
        const actionPrimary = ControlHarness.TokenCss('ActionPrimary');
        assert.equal(actionPrimary, 'rgb(34,130,77)');
        assert.ok(svg.includes(actionPrimary!), 'legacy Filled maps onto the Pragmatic primary surface');
        ControlHarness.Reset();
    });

    test('Variant = Danger renders the danger surface (@StateDanger)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new Button();
            b.Variant = ButtonVariant.Danger;
            return b;
        }, { scheme: PragmaticLight });
        // #C24532.
        const danger = ControlHarness.TokenCss('StateDanger');
        assert.equal(danger, 'rgb(194,69,50)');
        assert.ok(svg.includes(danger!), 'Danger paints @StateDanger');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new Button(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });

    test('focus paints the ring stroke (@BorderFocus)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new Button();
            b._setIsFocused(true);
            return b;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(34,130,77)');
        // @ActionPrimary resolves to the SAME rgb() as @BorderFocus, so a
        // bare svg.includes(borderFocus) would pass whether or not the ring
        // painted (the primary fill already contains that colour) — assert
        // the STROKE attribute specifically, which only the focus ring emits.
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused Button paints the @BorderFocus ring stroke');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with no grey fallback and paints the dark @ActionPrimary fill', () =>
    {
        // Unfocused, deliberately — no Pen is involved on this path. The
        // default (Primary) template sets PART_Root.Fill = @ActionPrimary
        // directly on a Border created fresh for THIS render, so its
        // DynamicResourceBinding wires to whichever Application is current
        // right now. See the skipped test below for the focus-ring path,
        // which does NOT share that property.
        const { svg } = ControlHarness.Render(() => new Button(), { scheme: PragmaticDark });
        const actionPrimary = ControlHarness.TokenCss('ActionPrimary');
        assert.equal(actionPrimary, 'rgb(34,130,77)', '@ActionPrimary under PragmaticDark is #22824D');
        assert.ok(svg.includes(actionPrimary!), 'Button paints @ActionPrimary under PragmaticDark');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral fallback — every token resolves under PragmaticDark');
        ControlHarness.Reset();
    });

    // Regression test for Wave-1 follow-up (E): tracked a real, scoped bug
    // where a `Pen [ Brush = @Token ]` trigger value (used here for
    // PART_FocusRing.Stroke) compiles to a SINGLE shared Pen instance
    // built once at template-construction time (see the compiled
    // buttons.template.mu.js: `new Pen()` sits inside a module-scope
    // const array, not inside the per-instance template-application
    // path). Pen is not a Visual, so its DynamicResourceBinding never
    // gets the attach/detach re-wire hook a fresh Border gets on every
    // templated instantiation — the binding stayed wired to whichever
    // Application was current the FIRST time that shared Pen was ever
    // built, for the lifetime of the process.
    //
    // ControlHarness activates a fresh `Application` per test (by design,
    // to stop state leaking between cases), so once ANY earlier test in
    // this file renders a focused Button under Light, the ring's resolved
    // colour used to pin to the Light @BorderFocus value forever — this
    // Dark-focused render used to still paint rgb(34,130,77) (Light)
    // instead of rgb(46,168,98) (Dark @BorderFocus / #2EA862).
    //
    // Confirmed this does NOT affect a real single-Application runtime
    // Light<->Dark toggle: ThemeManager.ApplyScheme mutates the SAME
    // Application's Resources in place, and that IS the Resources
    // dictionary the shared Pen's binding is subscribed to. The bug only
    // bit when Application.current was swapped to a DIFFERENT instance
    // (this harness; latent risk for multi-window / multi-Application
    // scenarios). Fixed in dynamic-resource.ts: DynamicResourceBinding now
    // re-wires on EVERY Application.current reassignment, not just the
    // initial null -> populated transition.
    test('focus ring paints @BorderFocus under Dark after a Light render', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new Button();
            b._setIsFocused(true);
            return b;
        }, { scheme: PragmaticDark });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(46,168,98)', '@BorderFocus under PragmaticDark is #2EA862');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused Button paints the dark @BorderFocus ring stroke');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral fallback — every token resolves under PragmaticDark');
        ControlHarness.Reset();
    });
});
