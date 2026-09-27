import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NoModifiers, PointerButton, type PointerEventInit } from '../../../runtime/index.js';
import { InputManager } from '../../../framework/index.js';
import { HeadlessTarget, SvgDrawingContext } from '../../../visual-engine/index.js';
import { Slider } from '../../../basic/slider.js';
import { SpinEdit } from '../../../basic/spin-edit.js';
import { TextBox } from '../../../basic/text-box.js';
import { Orientation } from '../../../basic/panels/orientation.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

// Minimal PointerEventInit builder — mirrors src/basic/tests/slider.test.ts's
// own `pointer()` helper (this file drives InputManager directly for the
// drag scenario, same as that suite, rather than through ControlHarness.Render
// — a real drag needs a live Arrange pass plus pointer injection between two
// paints, which the single-shot harness doesn't expose).
class SliderPointerEvents
{
    public static Pointer(overrides: Partial<PointerEventInit> = {}): PointerEventInit
    {
        return {
            HostX:       0,
            HostY:       0,
            Button:      PointerButton.Primary,
            Buttons:     1,
            Modifiers:   NoModifiers,
            PointerId:   0,
            Pressure:    0,
            PointerType: 'mouse',
            ...overrides,
        };
    }
}

// Parses the thumb's rendered GLOBAL geometry out of the SVG fragment, to
// regression-test a real layout bug (see task-5-report.md fix round 2):
// wrapping the thumb in a fixed-size PART_FocusRing shifted its rendered
// centre 2dp off the true value position, because Visual.Arrange's overflow
// handling anchors an oversized child FLUSH at its slot origin rather than
// centring it — a colour-only assertion (the rest of this file) can't catch
// that; only rendered coordinates can.
class SliderRenderGeometry
{
    // PART_FocusRing/PART_Thumb render as a `<g>` immediately containing its
    // own `<rect>` and then a NESTED `<g>` — a shape unique to this pair
    // (Track/Fill are flat, or at most singly wrapped in their own `<g>`).
    private static readonly RingThumbPattern =
        /<g transform="matrix\(1,0,0,1,(-?[\d.]+),(-?[\d.]+)\)">\s*<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"[^>]*\/>\s*<g transform="matrix\(1,0,0,1,(-?[\d.]+),(-?[\d.]+)\)">\s*<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"/;
    private static readonly GroupTransform = /<g transform="matrix\(1,0,0,1,(-?[\d.]+),(-?[\d.]+)\)">/g;
    private static readonly Rect = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"/g;

    // The thumb's GLOBAL centre — ring group offset + nested thumb group
    // offset + the thumb's own local rect (never Stroke-inset, since
    // PART_Thumb never sets Stroke).
    public static ThumbCenter(svg: string): { X: number; Y: number }
    {
        const m = SliderRenderGeometry.RingThumbPattern.exec(svg);
        assert.ok(m, 'expected the PART_FocusRing / PART_Thumb nested-group geometry in the rendered SVG');
        const [, ringX, ringY, , , , , thumbGroupX, thumbGroupY, thumbLocalX, thumbLocalY, thumbW, thumbH] = m!.map(Number);
        return {
            X: ringX! + thumbGroupX! + thumbLocalX! + thumbW! / 2,
            Y: ringY! + thumbGroupY! + thumbLocalY! + thumbH! / 2,
        };
    }

    // PART_Fill is always the second painted rect (after PART_Track),
    // rendered before the PART_FocusRing/PART_Thumb structure — located as
    // the last rect (optionally wrapped in its own single `<g>` translate,
    // when its ArrangedRect has a nonzero origin) preceding that nested
    // pattern's start index. Returns the fill's trailing edge along the
    // given orientation's primary axis — the same `thumbCentreX`/
    // `thumbCentreY` position Slider.ArrangeSliderParts derives the thumb's
    // own placement from, so this is an independent cross-check that the
    // fill and the thumb agree on where "the value" actually is.
    public static FillEdge(svg: string, orientation: Orientation): number
    {
        const ringMatch = SliderRenderGeometry.RingThumbPattern.exec(svg);
        assert.ok(ringMatch, 'expected the PART_FocusRing / PART_Thumb nested-group geometry in the rendered SVG');
        const preamble = svg.slice(0, ringMatch!.index);
        const lastGroup = [...preamble.matchAll(SliderRenderGeometry.GroupTransform)].pop();
        const groupX = lastGroup ? Number(lastGroup[1]) : 0;
        const groupY = lastGroup ? Number(lastGroup[2]) : 0;
        const rects = [...preamble.matchAll(SliderRenderGeometry.Rect)];
        const fillRect = rects[rects.length - 1]!;
        const fillX = groupX + Number(fillRect[1]);
        const fillY = groupY + Number(fillRect[2]);
        const fillW = Number(fillRect[3]);
        return orientation === Orientation.Vertical ? fillY : fillX + fillW;
    }
}

describe('Pragmatic Slider', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new Slider(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Slider uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected — a Slider under Material keeps the Material style', () =>
    {
        const { control } = ControlHarness.Render(() => new Slider(), { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material Slider does NOT resolve the Pragmatic style');
        ControlHarness.Reset();
    });

    test('track paints @Bg3', () =>
    {
        const { svg } = ControlHarness.Render(() => new Slider(), { scheme: PragmaticLight });
        const bg3 = ControlHarness.TokenCss('Bg3');
        assert.ok(svg.includes(bg3!), 'Slider track paints @Bg3');
        ControlHarness.Reset();
    });

    test('the value fill paints @ControlAccent (#22824D) — a progress fill, not a selected state', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const s = new Slider();
            s.Minimum = 0;
            s.Maximum = 100;
            s.Value = 50;
            return s;
        }, { scheme: PragmaticLight });
        const controlAccent = ControlHarness.TokenCss('ControlAccent');
        assert.equal(controlAccent, 'rgb(34,130,77)');
        assert.ok(svg.includes(controlAccent!), 'Slider fill paints @ControlAccent');
        ControlHarness.Reset();
    });

    test('the rendered thumb centre aligns with the true value position — Horizontal (regression: PART_FocusRing geometry)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sl = new Slider();
        sl.Minimum = 0;
        sl.Maximum = 100;
        sl.Value = 50;
        // Fixed width, auto height — a deterministic 200x16 arrange (see
        // the drag test below for the same pattern). At Value=50 (the
        // midpoint of [Min,Max]), the thumb's THUMB_PRIMARY/2 terms in
        // Slider.ArrangeSliderParts cancel out exactly, so the expected
        // centre is trackLength/2 regardless of the thumb's own pixel
        // size — an assertion that doesn't depend on THUMB_PRIMARY's
        // private value.
        const target = new HeadlessTarget(200, undefined, sl);
        const dc = new SvgDrawingContext();
        target.Render(dc);
        const svg = dc.ToFragment();

        const center = SliderRenderGeometry.ThumbCenter(svg);
        const fillEdge = SliderRenderGeometry.FillEdge(svg, Orientation.Horizontal);
        assert.equal(center.X, fillEdge, 'the thumb centre must land exactly on PART_Fill\'s trailing edge');
        assert.equal(center.X, 100, 'at Value=50 of [0,100] on a 200px track, the true centre is trackLength/2');
        ControlHarness.Reset();
    });

    test('the rendered thumb centre aligns with the true value position — Vertical (regression: PART_FocusRing geometry)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sl = new Slider();
        sl.Orientation = Orientation.Vertical;
        sl.Minimum = 0;
        sl.Maximum = 100;
        sl.Value = 50;
        // Fixed height, auto width — a deterministic 16x200 arrange.
        const target = new HeadlessTarget(undefined, 200, sl);
        const dc = new SvgDrawingContext();
        target.Render(dc);
        const svg = dc.ToFragment();

        const center = SliderRenderGeometry.ThumbCenter(svg);
        const fillEdge = SliderRenderGeometry.FillEdge(svg, Orientation.Vertical);
        assert.equal(center.Y, fillEdge, 'the thumb centre must land exactly on PART_Fill\'s edge');
        assert.equal(center.Y, 100, 'at Value=50 of [0,100] on a 200px track, the true centre is trackLength/2');
        ControlHarness.Reset();
    });

    test('focus paints the @BorderFocus ring as a stroke on a dedicated PART_FocusRing, not the thumb\'s own fill', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const s = new Slider();
            s._setIsFocused(true);
            return s;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused Slider paints @BorderFocus as a ring stroke');
        ControlHarness.Reset();
    });

    test('thumb hover paints @BrandGreenHover', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const s = new Slider();
            s.Thumb._setIsMouseOver(true);
            return s;
        }, { scheme: PragmaticLight });
        const hover = ControlHarness.TokenCss('BrandGreenHover');
        assert.ok(svg.includes(hover!), 'hovered thumb paints @BrandGreenHover');
        ControlHarness.Reset();
    });

    test('dragging the thumb paints @BrandGreenPress, winning over an already-hovered thumb', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sl = new Slider();
        sl.Minimum = 0;
        sl.Maximum = 100;
        sl.Value = 50;
        // Hover first — chronologically, a drag can only begin from an
        // already-hovered thumb (you must be over it to press it), so the
        // hover trigger's SetTriggerValue call is always first in a real
        // gesture. This test reproduces that order rather than asserting
        // an unreachable one.
        sl.Thumb._setIsMouseOver(true);

        const target = new HeadlessTarget(200, undefined, sl);
        target.Render(new SvgDrawingContext());

        const im = new InputManager();
        im.InjectPointerDown(sl.Thumb, SliderPointerEvents.Pointer({ HostX: 100, HostY: 8 }));
        im.InjectPointerMove(sl.Thumb, SliderPointerEvents.Pointer({ HostX: 105, HostY: 8 }));
        assert.equal(sl.IsDragging, true, 'the drag gesture is under way');

        const dc = new SvgDrawingContext();
        target.Render(dc);
        const svg = dc.ToFragment();

        const press = ControlHarness.TokenCss('BrandGreenPress');
        const hover = ControlHarness.TokenCss('BrandGreenHover');
        assert.ok(svg.includes(press!), 'dragging thumb paints @BrandGreenPress');
        assert.ok(!svg.includes(hover!), 'the drag colour wins outright — no lingering @BrandGreenHover paint');

        im.InjectPointerUp(sl.Thumb, SliderPointerEvents.Pointer({ HostX: 105, HostY: 8 }));
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new Slider(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with no grey fallback and paints the dark @ControlAccent fill', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const s = new Slider();
            s.Minimum = 0;
            s.Maximum = 100;
            s.Value = 50;
            return s;
        }, { scheme: PragmaticDark });
        const controlAccent = ControlHarness.TokenCss('ControlAccent');
        assert.equal(controlAccent, 'rgb(46,168,98)', '@ControlAccent under PragmaticDark is #2EA862');
        assert.ok(svg.includes(controlAccent!), 'Slider fill paints the dark @ControlAccent');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral fallback — every token resolves under PragmaticDark');
        ControlHarness.Reset();
    });
});

describe('Pragmatic SpinEdit', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new SpinEdit(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'SpinEdit uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected — a SpinEdit under Material keeps the Material style', () =>
    {
        const { control } = ControlHarness.Render(() => new SpinEdit(), { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material SpinEdit does NOT resolve the Pragmatic style');
        ControlHarness.Reset();
    });

    test('the Outlined chrome paints @BorderStrong as a border stroke (reused from PragmaticInputs)', () =>
    {
        const { svg } = ControlHarness.Render(() => new SpinEdit(), { scheme: PragmaticLight });
        const borderStrong = ControlHarness.TokenCss('BorderStrong');
        assert.ok(svg.includes(`stroke="${borderStrong}"`), 'unfocused SpinEdit paints @BorderStrong as a stroke');
        ControlHarness.Reset();
    });

    test('focusing the inner value field paints @BorderFocus on the outer border as a stroke', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const se = new SpinEdit();
            const innerText = se.GetTemplateChild('PART_TextBox') as TextBox;
            innerText._setIsFocused(true);
            return se;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused SpinEdit paints @BorderFocus as a stroke');
        ControlHarness.Reset();
    });

    test('the divider between the value field and the stepper column paints @Border as a stroke', () =>
    {
        const { svg } = ControlHarness.Render(() => new SpinEdit(), { scheme: PragmaticLight });
        const border = ControlHarness.TokenCss('Border');
        assert.ok(svg.includes(`stroke="${border}"`), 'SpinEdit column divider paints @Border as a stroke');
        ControlHarness.Reset();
    });

    test('the stepper buttons are ghost-style — hovering PART_Up paints @Bg2', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const se = new SpinEdit();
            const up = se.GetTemplateChild('PART_Up') as unknown as { _setIsMouseOver(v: boolean): void };
            up._setIsMouseOver(true);
            return se;
        }, { scheme: PragmaticLight });
        const bg2 = ControlHarness.TokenCss('Bg2');
        assert.ok(svg.includes(bg2!), 'hovered PART_Up paints @Bg2');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new SpinEdit(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });
});
