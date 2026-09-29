import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { IconButton } from '../../../framework/buttons/icon-button.js';
import { IconButtonToggle } from '../../../framework/buttons/icon-button-toggle.js';
import { FloatingActionButton, FabSize } from '../../../framework/buttons/fab.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
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

    test('focus paints the ring stroke (@BorderFocus)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new IconButton();
            b._setIsFocused(true);
            return b;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(34,130,77)');
        // @ActionPrimary (and other Pragmatic surfaces) can resolve to the
        // SAME rgb() as @BorderFocus, so a bare svg.includes(borderFocus)
        // would pass whether or not the ring actually painted — assert the
        // STROKE attribute specifically, which only the focus ring emits.
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused IconButton paints the @BorderFocus ring stroke');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with no grey fallback and paints the dark @Bg2 hover surface', () =>
    {
        // Unfocused, deliberately — no Pen is involved on this path. A
        // bare rest IconButton paints nothing (PART_Root.Fill is the
        // literal #00000000, not a resource), so hover is the cheapest
        // state that exercises a real per-instance DynamicResource-bound
        // Fill (@Bg2) without touching the focus-ring Pen. See the
        // skipped test below for the focus-ring path and why it's
        // tracked separately.
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new IconButton();
            b._setIsMouseOver(true);
            return b;
        }, { scheme: PragmaticDark });
        const bg2 = ControlHarness.TokenCss('Bg2');
        assert.equal(bg2, 'rgb(34,33,30)', '@Bg2 under PragmaticDark is #22211E');
        assert.ok(svg.includes(bg2!), 'hovered IconButton paints @Bg2 under PragmaticDark');
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
    test('focus ring paints @BorderFocus under Dark after a Light render', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new IconButton();
            b._setIsFocused(true);
            return b;
        }, { scheme: PragmaticDark });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(46,168,98)', '@BorderFocus under PragmaticDark is #2EA862');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused IconButton paints the dark @BorderFocus ring stroke');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral fallback — every token resolves under PragmaticDark');
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

    test('checked + hovered keeps the selected surface — hover must not erase the checked cue', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const t = new IconButtonToggle();
            t.IsChecked = true;
            // Force the hover DP the way the input pipeline would while the
            // pointer sits over an already-checked toggle. Regression guard:
            // a ControlTemplate trigger stack resolves a shared-property tie
            // by whichever condition's SetTriggerValue call happens LAST AT
            // RUNTIME (here, whichever DP is mutated last — IsChecked, then
            // IsMouseOver), never by which `when` clause is declared last in
            // the .mu file. Setting IsChecked before forcing hover reproduces
            // exactly the "already checked, then hovered" sequence that used
            // to erase the checked cue when both triggers wrote the same
            // PART_Root.Fill. The fix paints the checked surface on a
            // separate, opaquely-covering PART_Selected layer nested inside
            // PART_Root, so it wins by z-order compositing — not trigger
            // timing — regardless of which DP changed most recently.
            t._setIsMouseOver(true);
            return t;
        }, { scheme: PragmaticLight });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        const hover = ControlHarness.TokenCss('Bg2');
        const selectedIndex = svg.indexOf(selected!);
        const hoverIndex = svg.indexOf(hover!);
        assert.notEqual(selectedIndex, -1, 'checked + hovered IconButtonToggle still paints @SurfaceSelected');
        assert.notEqual(hoverIndex, -1, 'the hover surface (@Bg2) still paints underneath — this is the base ghost layer');
        assert.ok(selectedIndex > hoverIndex,
            'the @SurfaceSelected layer must paint AFTER (on top of, in SVG document order) the @Bg2 hover layer, ' +
            'so the checked cue visually wins while hovered');
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
