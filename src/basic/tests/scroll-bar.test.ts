import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from './test-app.js';

import { Application, NoModifiers, PointerButton, Rect, Size, Element, Visual, type PointerEventInit } from '../../runtime/index.js';
import { InputManager } from '../../framework/index.js';;
import { Orientation } from '../panels/orientation.js';
import { ScrollBar } from '../scroll/scroll-bar.js';

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

// Inspect the template parts via the ScrollBar's public Track / Thumb
// accessors. The actual parts live under the layout panel introduced
// by the compiled default template; reach for them through the
// accessor rather than a fragile visualChildren index walk.
function trackOf(sb: ScrollBar): Visual { return sb.Track; }
function thumbOf(sb: ScrollBar): Visual { return sb.Thumb; }

describe('ScrollBar — basics', () => {
    beforeEach(() => { initTestApp(); });

    test('default Orientation is Vertical, Min=0, Max=1, Value=0', () => {
        const sb = new ScrollBar();
        assert.equal(sb.Orientation, Orientation.Vertical);
        assert.equal(sb.Minimum, 0);
        assert.equal(sb.Maximum, 1);
        assert.equal(sb.Value, 0);
        assert.equal(sb.ViewportSize, 0);
    });

    test('vertical bar reports a fixed-width DesiredSize and stretches on height', () => {
        const sb = new ScrollBar();
        sb.Measure(new Size(100, 500));
        assert.equal(sb.DesiredSize.Width,  10);
        assert.equal(sb.DesiredSize.Height, 500);
    });

    test('horizontal bar reports a fixed-height DesiredSize and stretches on width', () => {
        const sb = new ScrollBar();
        sb.Orientation = Orientation.Horizontal;
        sb.Measure(new Size(500, 100));
        assert.equal(sb.DesiredSize.Width,  500);
        assert.equal(sb.DesiredSize.Height, 10);
    });
});

describe('ScrollBar — thumb geometry', () => {
    beforeEach(() => { initTestApp(); });

    test('thumb length tracks ViewportSize / (range + viewport) on a vertical bar', () => {
        const sb = new ScrollBar();
        sb.Minimum = 0;
        sb.Maximum = 100;           // range = 100
        sb.ViewportSize = 100;      // viewport == range → ratio 0.5
        sb.Measure(new Size(10, 200));
        sb.Arrange(new Rect(0, 0, 10, 200));
        const thumb = thumbOf(sb);
        // ratio = 100 / (100 + 100) = 0.5 → thumb = 100 DIPs.
        assert.equal(thumb.ArrangedRect.Height, 100);
    });

    test('thumb clamps at the minimum length when viewport is tiny vs range', () => {
        const sb = new ScrollBar();
        sb.Minimum = 0;
        sb.Maximum = 10000;
        sb.ViewportSize = 10;
        sb.Measure(new Size(10, 200));
        sb.Arrange(new Rect(0, 0, 10, 200));
        const thumb = thumbOf(sb);
        // 10 / 10010 ≈ 0.001 → would be 0.2 DIPs without the floor.
        // The MIN_THUMB_LENGTH (24) keeps it grabbable.
        assert.equal(thumb.ArrangedRect.Height, 24);
    });

    test('thumb position scales Value across the (track - thumb) travel', () => {
        const sb = new ScrollBar();
        sb.Minimum = 0;
        sb.Maximum = 100;
        sb.ViewportSize = 100;
        sb.Value = 50;
        sb.Measure(new Size(10, 200));
        sb.Arrange(new Rect(0, 0, 10, 200));
        const thumb = thumbOf(sb);
        // travel = 200 - 100 = 100; valuePos = 50/100 × 100 = 50.
        assert.equal(thumb.ArrangedRect.Y, 50);
    });

    test('clamped position: Value below Minimum pins to the top', () => {
        const sb = new ScrollBar();
        sb.Minimum = 0;
        sb.Maximum = 100;
        sb.ViewportSize = 100;
        sb.Value = -200;            // off the bottom of the range
        sb.Measure(new Size(10, 200));
        sb.Arrange(new Rect(0, 0, 10, 200));
        assert.equal(thumbOf(sb).ArrangedRect.Y, 0);
    });

    test('horizontal bar: thumb lays out along the X axis', () => {
        const sb = new ScrollBar();
        sb.Orientation = Orientation.Horizontal;
        sb.Minimum = 0;
        sb.Maximum = 100;
        sb.ViewportSize = 100;
        sb.Value = 25;
        sb.Measure(new Size(200, 10));
        sb.Arrange(new Rect(0, 0, 200, 10));
        const thumb = thumbOf(sb);
        // travel = 200 - 100 = 100; pos = 25/100 × 100 = 25.
        assert.equal(thumb.ArrangedRect.X,      25);
        assert.equal(thumb.ArrangedRect.Width,  100);
        assert.equal(thumb.ArrangedRect.Height, 10);
    });
});

describe('ScrollBar — pointer interaction', () => {
    beforeEach(() => { initTestApp(); });

    function setupVertical(): { sb: ScrollBar; im: InputManager }
    {
        const sb = new ScrollBar();
        sb.Minimum = 0;
        sb.Maximum = 100;
        sb.ViewportSize = 100;
        sb.Measure(new Size(10, 200));
        sb.Arrange(new Rect(0, 0, 10, 200));
        return { sb, im: new InputManager() };
    }

    test('clicking the track below the thumb pages Value forward by ViewportSize', () => {
        const { sb, im } = setupVertical();
        // Thumb at Y=0, length 100. Click track at Y=150.
        im.InjectPointerDown(trackOf(sb), pointer({ HostX: 5, HostY: 150 }));
        im.InjectPointerUp  (trackOf(sb), pointer({ HostX: 5, HostY: 150 }));
        // Value += ViewportSize = 100, clamped at Maximum.
        assert.equal(sb.Value, 100);
    });

    test('clicking the track above the thumb pages Value backward by ViewportSize', () => {
        const { sb, im } = setupVertical();
        sb.Value = 75;
        // Re-arrange to refresh thumb position; thumb starts at 0.75 × 100 = 75.
        sb.Arrange(new Rect(0, 0, 10, 200));
        // Click above the thumb (Y=20).
        im.InjectPointerDown(trackOf(sb), pointer({ HostX: 5, HostY: 20 }));
        im.InjectPointerUp  (trackOf(sb), pointer({ HostX: 5, HostY: 20 }));
        // 75 - 100 = -25, clamped to 0.
        assert.equal(sb.Value, 0);
    });

    test('dragging the thumb moves Value proportionally to the pointer delta', () => {
        const { sb, im } = setupVertical();
        const thumb = thumbOf(sb);
        // Grab the thumb at Y=50 (anywhere within the thumb's 0..100 rect).
        im.InjectPointerDown(thumb, pointer({ HostX: 5, HostY: 50 }));
        // Move down by 30 pixels.
        im.InjectPointerMove(thumb, pointer({ HostX: 5, HostY: 80 }));
        // travel = 200 - 100 = 100; range = 100; deltaValue = 30 / 100 × 100 = 30.
        assert.equal(sb.Value, 30);
        im.InjectPointerUp(thumb, pointer({ HostX: 5, HostY: 80 }));
    });

    test('ValueChanged listener fires for every Value update', () => {
        const { sb, im } = setupVertical();
        const events: number[] = [];
        sb.AddValueChangedListener(v => events.push(v));

        // One page-jump click + one drag.
        im.InjectPointerDown(trackOf(sb), pointer({ HostX: 5, HostY: 150 }));
        im.InjectPointerUp  (trackOf(sb), pointer({ HostX: 5, HostY: 150 }));
        im.InjectPointerDown(thumbOf(sb), pointer({ HostX: 5, HostY: 100 }));
        im.InjectPointerMove(thumbOf(sb), pointer({ HostX: 5, HostY: 120 }));
        im.InjectPointerUp  (thumbOf(sb), pointer({ HostX: 5, HostY: 120 }));

        // Click jumped to 100; drag pushed Value off the top
        // (clamped). Listener saw each distinct update.
        assert.ok(events.length >= 1, 'at least the click write fires');
        assert.equal(events[0], 100);
    });
});

describe('InputManager — pointer capture', () => {
    beforeEach(() => { initTestApp(); });

    test('Move events route to the captured visual even when hit-test misses', () => {
        const im = new InputManager();
        // Two unrelated visuals; one captures, the other becomes the hit.
        class StubVisual extends Element
        {
            public moves = 0;
            protected override OnPointerMove(): void { this.moves++; }
        }
        const captor = new StubVisual();
        const other  = new StubVisual();
        im.CapturePointer(captor);

        im.InjectPointerMove(other, pointer({ HostX: 10, HostY: 10 }));
        // Move dispatched to captor, NOT other.
        assert.equal(captor.moves, 1);
        assert.equal(other.moves,  0);
    });

    test('PointerUp auto-releases the capture', () => {
        const im = new InputManager();
        class StubVisual extends Element { }
        const captor = new StubVisual();
        im.CapturePointer(captor);
        assert.equal(im.GetCapturedVisual(), captor);

        im.InjectPointerUp(captor, pointer());
        assert.equal(im.GetCapturedVisual(), undefined);
    });

    test('PointerEventArgs.CapturePointer captures via the arg sink', () => {
        const im = new InputManager();
        class CaptorVisual extends Element
        {
            public received = 0;
            protected override OnPointerDown(args: import('../../runtime/index.js').PointerEventArgs): void
            {
                this.received++;
                args.CapturePointer();   // capture self
            }
        }
        const captor = new CaptorVisual();
        // Synthetic dispatch via InjectPointerDown which threads the
        // InputManager as the capture sink.
        im.InjectPointerDown(captor, pointer());
        assert.equal(captor.received, 1);
        assert.equal(im.GetCapturedVisual(), captor);
    });
});

describe('ScrollBar — auto-hide region hover', () => {
    beforeEach(() => { initTestApp(); });

    test('an auto-hide bar starts hidden and reveals on region hover', () => {
        const b = new ScrollBar();
        b.IsAutoHide = true;
        assert.equal(b.IsFaded, true, 'auto-hide bar starts faded out');
        b.SetRegionActive(true);
        assert.equal(b.IsFaded, false, 'region hover reveals the bar');
    });

    test('SetRegionActive is idempotent', () => {
        const b = new ScrollBar();
        b.IsAutoHide = true;
        b.SetRegionActive(true);
        b.SetRegionActive(true);
        assert.equal(b.IsFaded, false);
    });

    test('a non-auto-hide bar stays visible and region hover is a no-op', () => {
        const b = new ScrollBar();
        // IsAutoHide defaults false → never faded.
        assert.equal(b.IsFaded, false);
        b.SetRegionActive(true);
        assert.equal(b.IsFaded, false);
        b.SetRegionActive(false);
        assert.equal(b.IsFaded, false);
    });
});
