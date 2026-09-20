import { ModifierKeys, toModifierKeys } from '../../runtime/index.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from './test-app.js';

import { Application, Key, NoModifiers, PointerButton, Rect, Size, type KeyEventInit, type ModifierKeys, type PointerEventInit } from '../../runtime/index.js';
import { InputManager } from '../../framework/index.js';;
import { HeadlessTarget } from '../../visual-engine/index.js';
import { Slider } from '../slider.js';
import { Orientation } from '../panels/orientation.js';

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

function key(k: Key, mods: Partial<ModifierKeys> = {}, code?: string): KeyEventInit
{
    return {
        Key:       k,
        KeyText:       k,
        Code:      code ?? k,
        Modifiers: toModifierKeys({ shift: mods.Shift, control: mods.Control, alt: mods.Alt, meta: mods.Meta }),
        IsRepeat:  false,
    };
}

// Stand up a horizontal Slider arranged at (0,0,200,16). Track length
// 200; travel = 200 - 4 = 196 (Phase 8.6 M3 2024:
// thumb narrows to 4dp pill). Returns the slider plus its template
// part handles for direct pointer routing.
function horizontalAt200(): { sl: Slider; track: ReturnType<Slider['Track' & keyof Slider]>; thumb: ReturnType<Slider['Thumb' & keyof Slider]> }
{
    const sl = new Slider();
    sl.Minimum = 0;
    sl.Maximum = 100;
    sl.Measure(new Size(200, 16));
    sl.Arrange(new Rect(0, 0, 200, 16));
    return { sl, track: sl.Track, thumb: sl.Thumb };
}

describe('Slider — defaults', () => {
    beforeEach(() => { initTestApp(); });

    test('default Orientation=Horizontal, Min=0, Max=1, Value=0', () => {
        const sl = new Slider();
        assert.equal(sl.Orientation, Orientation.Horizontal);
        assert.equal(sl.Minimum,     0);
        assert.equal(sl.Maximum,     1);
        assert.equal(sl.Value,       0);
        assert.equal(sl.SmallChange, 0.01);
        assert.equal(sl.LargeChange, 0.1);
    });

    test('horizontal slider DesiredSize: stretches on width, fixed 16 DIP cross-axis', () => {
        const sl = new Slider();
        sl.Measure(new Size(300, 100));
        assert.equal(sl.DesiredSize.Width,  300);
        assert.equal(sl.DesiredSize.Height, 16);
    });

    test('vertical slider DesiredSize: stretches on height, fixed 16 DIP cross-axis', () => {
        const sl = new Slider();
        sl.Orientation = Orientation.Vertical;
        sl.Measure(new Size(100, 300));
        assert.equal(sl.DesiredSize.Width,  16);
        assert.equal(sl.DesiredSize.Height, 300);
    });

    test('Focusable is true so the slider receives keyboard input', () => {
        assert.equal(new Slider().Focusable, true);
    });
});

describe('Slider — horizontal thumb geometry', () => {
    beforeEach(() => { initTestApp(); });

    test('Value=Min → thumb at the left edge of the track', () => {
        const { sl } = horizontalAt200();
        sl.Value = 0;
        sl.Arrange(new Rect(0, 0, 200, 16));
        assert.equal(sl.Thumb.ArrangedRect.X,      0);
        assert.equal(sl.Thumb.ArrangedRect.Width,  4);
        assert.equal(sl.Thumb.ArrangedRect.Height, 16);
    });

    test('Value=Max → thumb at the right edge (X = trackLength - thumbSize)', () => {
        const { sl } = horizontalAt200();
        sl.Value = 100;
        sl.Arrange(new Rect(0, 0, 200, 16));
        // travel = 200 - 4 = 196 → leading edge X=196.
        assert.equal(sl.Thumb.ArrangedRect.X, 196);
    });

    test('Value=mid-range → thumb position scales proportionally', () => {
        const { sl } = horizontalAt200();
        sl.Value = 50;
        sl.Arrange(new Rect(0, 0, 200, 16));
        // 50/100 × 196 = 98.
        assert.equal(sl.Thumb.ArrangedRect.X, 98);
    });

    test('Fill width spans from track left edge to the thumb centre', () => {
        const { sl } = horizontalAt200();
        sl.Value = 50;
        sl.Arrange(new Rect(0, 0, 200, 16));
        // Thumb leading edge 98 + half-thumb 2 = 100.
        assert.equal(sl.TrackFill.ArrangedRect.Width, 100);
    });

    test('Track spans the full primary length', () => {
        const { sl } = horizontalAt200();
        sl.Arrange(new Rect(0, 0, 200, 16));
        assert.equal(sl.Track.ArrangedRect.Width, 200);
    });
});

describe('Slider — vertical thumb geometry (Min at bottom)', () => {
    beforeEach(() => { initTestApp(); });

    function verticalAt200(): Slider
    {
        const sl = new Slider();
        sl.Orientation = Orientation.Vertical;
        sl.Minimum = 0;
        sl.Maximum = 100;
        sl.Measure(new Size(16, 200));
        sl.Arrange(new Rect(0, 0, 16, 200));
        return sl;
    }

    test('Value=Min → thumb at the BOTTOM of the track (Y = trackLength - thumbSize)', () => {
        const sl = verticalAt200();
        sl.Value = 0;
        sl.Arrange(new Rect(0, 0, 16, 200));
        assert.equal(sl.Thumb.ArrangedRect.Y, 196);
    });

    test('Value=Max → thumb at the TOP (Y = 0)', () => {
        const sl = verticalAt200();
        sl.Value = 100;
        sl.Arrange(new Rect(0, 0, 16, 200));
        assert.equal(sl.Thumb.ArrangedRect.Y, 0);
    });
});

describe('Slider — clamping', () => {
    beforeEach(() => { initTestApp(); });

    test('Out-of-range Value writes are preserved on the DP, painted clamped', () => {
        const { sl } = horizontalAt200();
        sl.Value = 9999;
        sl.Arrange(new Rect(0, 0, 200, 16));
        // Raw DP value preserved (matches ScrollBar's "binding source
        // wins" convention).
        assert.equal(sl.Value, 9999);
        // Painted thumb is at the Max position (X = 196).
        assert.equal(sl.Thumb.ArrangedRect.X, 196);
    });

    test('Negative Value writes paint clamped at the Min position', () => {
        const { sl } = horizontalAt200();
        sl.Value = -50;
        sl.Arrange(new Rect(0, 0, 200, 16));
        assert.equal(sl.Thumb.ArrangedRect.X, 0);
    });

    test('range = 0 (Min == Max) parks the thumb at the Min position', () => {
        const sl = new Slider();
        sl.Minimum = 5;
        sl.Maximum = 5;
        sl.Value   = 5;
        sl.Measure(new Size(200, 16));
        sl.Arrange(new Rect(0, 0, 200, 16));
        assert.equal(sl.Thumb.ArrangedRect.X, 0);
    });
});

describe('Slider — keyboard', () => {
    beforeEach(() => { initTestApp(); });

    function focused(): { sl: Slider; im: InputManager }
    {
        const sl = new Slider();
        sl.Minimum = 0;
        sl.Maximum = 100;
        sl.SmallChange = 1;
        sl.LargeChange = 10;
        const target = new HeadlessTarget(200, 60);
        target.Content = sl;
        target.Flush();
        target.InputManager.SetFocus(sl);
        return { sl, im: target.InputManager };
    }

    test('ArrowRight / ArrowUp increase Value by SmallChange', () => {
        const { sl, im } = focused();
        sl.Value = 50;
        im.InjectKeyDown(key(Key.Right));
        assert.equal(sl.Value, 51);
        im.InjectKeyDown(key(Key.Up));
        assert.equal(sl.Value, 52);
    });

    test('ArrowLeft / ArrowDown decrease Value by SmallChange', () => {
        const { sl, im } = focused();
        sl.Value = 50;
        im.InjectKeyDown(key(Key.Left));
        assert.equal(sl.Value, 49);
        im.InjectKeyDown(key(Key.Down));
        assert.equal(sl.Value, 48);
    });

    test('PageUp / PageDown use LargeChange', () => {
        const { sl, im } = focused();
        sl.Value = 50;
        im.InjectKeyDown(key(Key.PageUp));
        assert.equal(sl.Value, 60);
        im.InjectKeyDown(key(Key.PageDown));
        assert.equal(sl.Value, 50);
    });

    test('Home and End snap to Min / Max', () => {
        const { sl, im } = focused();
        sl.Value = 50;
        im.InjectKeyDown(key(Key.Home));
        assert.equal(sl.Value, 0);
        im.InjectKeyDown(key(Key.End));
        assert.equal(sl.Value, 100);
    });

    test('Keyboard increments clamp at Min / Max', () => {
        const { sl, im } = focused();
        sl.Value = 100;
        im.InjectKeyDown(key(Key.Right));
        assert.equal(sl.Value, 100, 'ArrowRight at Max is a no-op');
        sl.Value = 0;
        im.InjectKeyDown(key(Key.Left));
        assert.equal(sl.Value, 0, 'ArrowLeft at Min is a no-op');
    });
});

describe('Slider — pointer interaction', () => {
    beforeEach(() => { initTestApp(); });

    test('Dragging the thumb moves Value proportionally to the pointer delta', () => {
        const { sl, thumb } = horizontalAt200();
        sl.Value = 0;
        sl.Arrange(new Rect(0, 0, 200, 16));

        const im = new InputManager();
        // Grab the thumb anywhere on it (HostX=2 — middle of the 4dp
        // narrow pill at the leftmost arrangement).
        im.InjectPointerDown(thumb, pointer({ HostX: 2, HostY: 8 }));
        // Move 98 pixels to the right.
        im.InjectPointerMove(thumb, pointer({ HostX: 100, HostY: 8 }));
        // travel = 196, range = 100 → deltaValue = 98 / 196 × 100 = 50.
        assert.equal(sl.Value, 50);
        im.InjectPointerUp(thumb, pointer({ HostX: 100, HostY: 8 }));
    });

    test('Clicking the track jumps the thumb to under the pointer (centred)', () => {
        const { sl, track } = horizontalAt200();
        sl.Value = 0;
        sl.Arrange(new Rect(0, 0, 200, 16));

        const im = new InputManager();
        // Click at X=100 — the centre of the track.
        im.InjectPointerDown(track, pointer({ HostX: 100, HostY: 8 }));
        // valueForPointerPx: leadingPx = 100 - 2 = 98 → 98 / 196 × 100 = 50.
        assert.equal(sl.Value, 50);
        im.InjectPointerUp(track, pointer({ HostX: 100, HostY: 8 }));
    });

    test('Track-click value is clamped to [Min, Max]', () => {
        const { sl, track } = horizontalAt200();
        sl.Value = 50;
        sl.Arrange(new Rect(0, 0, 200, 16));

        const im = new InputManager();
        // Click far past the right edge — should clamp to Max.
        im.InjectPointerDown(track, pointer({ HostX: 9999, HostY: 8 }));
        assert.equal(sl.Value, 100);
        im.InjectPointerUp(track, pointer({ HostX: 9999, HostY: 8 }));
    });

    test('Vertical drag: DOWN movement DECREASES Value (Min at bottom)', () => {
        const sl = new Slider();
        sl.Orientation = Orientation.Vertical;
        sl.Minimum = 0;
        sl.Maximum = 100;
        sl.Value   = 100;             // thumb at the top
        sl.Measure(new Size(16, 200));
        sl.Arrange(new Rect(0, 0, 16, 200));

        const im = new InputManager();
        // Press on the thumb at its top edge (HostY=2 — centre of the
        // 0..4 narrow pill, vertical orientation).
        im.InjectPointerDown(sl.Thumb, pointer({ HostX: 8, HostY: 2 }));
        // Move DOWN by 98 pixels.
        im.InjectPointerMove(sl.Thumb, pointer({ HostX: 8, HostY: 100 }));
        // Vertical sign-flip: deltaPx = +98, signedDelta = -98, deltaValue =
        // -98/196 × 100 = -50 → Value = 100 + (-50) = 50.
        assert.equal(sl.Value, 50);
        im.InjectPointerUp(sl.Thumb, pointer({ HostX: 8, HostY: 100 }));
    });
});

describe('Slider — ValueChanged listeners', () => {
    beforeEach(() => { initTestApp(); });

    test('Listener fires with the committed value on every change', () => {
        const sl = new Slider();
        sl.Minimum = 0;
        sl.Maximum = 100;
        sl.Value   = 0;

        const events: number[] = [];
        sl.AddValueChangedListener(v => events.push(v));

        sl.Value = 50;
        sl.Value = 75;
        sl.Value = 75;   // same → no fire (set_property_value short-circuits same writes)

        assert.deepEqual(events, [50, 75]);
    });

    test('RemoveValueChangedListener stops further notifications', () => {
        const sl = new Slider();
        const events: number[] = [];
        const l = (v: number) => events.push(v);
        sl.AddValueChangedListener(l);
        sl.Value = 0.5;
        sl.RemoveValueChangedListener(l);
        sl.Value = 0.7;
        assert.deepEqual(events, [0.5]);
    });
});
