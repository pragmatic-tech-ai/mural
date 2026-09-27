import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NoModifiers, PointerButton, type PointerEventInit } from '../../../runtime/index.js';
import { InputManager } from '../../../framework/index.js';
import { HeadlessTarget, SvgDrawingContext } from '../../../visual-engine/index.js';
import { Slider } from '../../../basic/slider.js';
import { SpinEdit } from '../../../basic/spin-edit.js';
import { TextBox } from '../../../basic/text-box.js';
import { PragmaticLight } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

// Minimal PointerEventInit builder — mirrors src/basic/tests/slider.test.ts's
// own `pointer()` helper (this file drives InputManager directly for the
// drag scenario, same as that suite, rather than through ControlHarness.Render
// — a real drag needs a live Arrange pass plus pointer injection between two
// paints, which the single-shot harness doesn't expose).
function pointer(overrides: Partial<PointerEventInit> = {}): PointerEventInit
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
        im.InjectPointerDown(sl.Thumb, pointer({ HostX: 100, HostY: 8 }));
        im.InjectPointerMove(sl.Thumb, pointer({ HostX: 105, HostY: 8 }));
        assert.equal(sl.IsDragging, true, 'the drag gesture is under way');

        const dc = new SvgDrawingContext();
        target.Render(dc);
        const svg = dc.ToFragment();

        const press = ControlHarness.TokenCss('BrandGreenPress');
        const hover = ControlHarness.TokenCss('BrandGreenHover');
        assert.ok(svg.includes(press!), 'dragging thumb paints @BrandGreenPress');
        assert.ok(!svg.includes(hover!), 'the drag colour wins outright — no lingering @BrandGreenHover paint');

        im.InjectPointerUp(sl.Thumb, pointer({ HostX: 105, HostY: 8 }));
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new Slider(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
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
