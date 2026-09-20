import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { ModifierKeys, WheelDeltaMode, type WheelEventArgs } from '../../../runtime/index.js';
import { Diagram } from '../diagram.js';
import { attachZoomPan } from '../behaviors/zoom-pan-behavior.js';

// Minimal wheel arg matching the fields the handler reads. Handled starts false
// so the test can observe whether the handler consumed the event.
function wheel(hostX: number, hostY: number, deltaY: number, ctrl: boolean): WheelEventArgs
{
    return {
        HostX: hostX, HostY: hostY, DeltaX: 0, DeltaY: deltaY, DeltaMode: WheelDeltaMode.Pixel,
        Modifiers: ctrl ? ModifierKeys.Control : ModifierKeys.None, Handled: false,
    } as unknown as WheelEventArgs;
}

describe('ZoomPanBehavior', () => {
    beforeEach(() => { initTestApp(); });

    test('ctrl+wheel-up zooms in about the cursor and marks the event handled', () => {
        const d = new Diagram();
        const detach = attachZoomPan(d);
        d.SetCamera({ zoom: 1, offsetX: 0, offsetY: 0 });
        const a = wheel(100, 100, -100, true);   // ctrl + wheel-up (zoom in)
        d._dispatchWheel(a);
        assert.ok(d.Zoom > 1);
        assert.equal(a.Handled, true);
        detach();
    });

    test('plain wheel is ignored so it bubbles to the ScrollViewer', () => {
        const d = new Diagram();
        const detach = attachZoomPan(d);
        d.SetCamera({ zoom: 1, offsetX: 0, offsetY: 0 });
        const a = wheel(0, 0, 120, false);       // no ctrl
        d._dispatchWheel(a);
        assert.equal(d.Zoom, 1);                  // no zoom change
        assert.equal(a.Handled, false);           // left for the ScrollViewer
        detach();
    });

    test('detach stops the behavior reacting', () => {
        const d = new Diagram();
        const detach = attachZoomPan(d);
        detach();
        d.SetCamera({ zoom: 1, offsetX: 0, offsetY: 0 });
        d._dispatchWheel(wheel(50, 50, -100, true));
        assert.equal(d.Zoom, 1);
    });

    test('CameraEnabled gates attaching the behavior', () => {
        const d = new Diagram();
        d.SetCamera({ zoom: 1, offsetX: 0, offsetY: 0 });
        // Not enabled → no handler installed → wheel does nothing.
        d._dispatchWheel(wheel(0, 0, -100, true));
        assert.equal(d.Zoom, 1);
        // Enable → attaches → wheel now zooms.
        d.CameraEnabled = true;
        d._dispatchWheel(wheel(0, 0, -100, true));
        assert.ok(d.Zoom > 1);
        // Disable → detaches → wheel inert again.
        const z = d.Zoom;
        d.CameraEnabled = false;
        d._dispatchWheel(wheel(0, 0, -100, true));
        assert.equal(d.Zoom, z);
    });
});
