import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    AnimationManager,
    Color,
    Easings,
    ManualClock,
    MetaData,
    MuralBase,
    PropertyTransition,
    Element,
    Visual,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { SolidColorBrush } from '../drawing/brush.js';
// Importing this module triggers the registerImplicitTransitionBuilder
// side effect that wires SolidColorBrush into the runtime's implicit-
// transition engine. Without this import, brush transitions would
// silently snap.
import '../drawing/solid-color-brush-animation.js';

// Lightweight Visual subclass with one Brush-typed DP. The DP itself
// lives in runtime — only the value type sits in visual-engine.
class BrushVisualTest extends Element
{
    static
    {
        MuralBase.RegisterProperty(BrushVisualTest, 'Brush',
            new SolidColorBrush(Color.Black), MetaData.None);
    }
    public get Brush():  SolidColorBrush { return this.get_property_value(resolveKey(this, undefined, 'Brush')); }
    public set Brush(v: SolidColorBrush) { this.set_property_value(resolveKey(this, undefined, 'Brush'), v); }
}

function freshClock(): ManualClock
{
    AnimationManager.ResetForTests();
    const clock = new ManualClock();
    AnimationManager.Instance.Clock = clock;
    return clock;
}

describe('Implicit transition — SolidColorBrush via registered builder', () => {
    let clock: ManualClock;
    beforeEach(() => { clock = freshClock(); });

    test('a Brush-typed DP write fires a SolidColorBrushAnimation', () => {
        const v = new BrushVisualTest();
        const t = new PropertyTransition();
        t.Property = 'Brush';
        t.Duration = 100;
        t.Easing   = Easings.Linear;
        v.EnsureTransitions().Add(t);

        v.Brush = new SolidColorBrush(Color.Black);
        v.Brush = new SolidColorBrush(Color.White);

        // First tick (Begin's AdvanceTo(0)) pins the From colour on the
        // Animated tier. The visible brush is the From colour.
        const start = v.Brush;
        assert.ok(start instanceof SolidColorBrush);
        assert.equal(start.Color.R, 0);
        assert.equal(start.Color.G, 0);
        assert.equal(start.Color.B, 0);

        // Midpoint of black → white (linear) = 127.5 per channel.
        clock.Tick(50);
        const mid = v.Brush;
        assert.equal(mid.Color.R, 127.5);
        assert.equal(mid.Color.G, 127.5);
        assert.equal(mid.Color.B, 127.5);

        // End — full white.
        clock.Tick(50);
        const end = v.Brush;
        assert.equal(end.Color.R, 255);
        assert.equal(end.Color.G, 255);
        assert.equal(end.Color.B, 255);
    });

    test('re-write during a brush transition cancels prior, retargets', () => {
        const v = new BrushVisualTest();
        const t = new PropertyTransition();
        t.Property = 'Brush';
        t.Duration = 100;
        t.Easing   = Easings.Linear;
        v.EnsureTransitions().Add(t);

        v.Brush = new SolidColorBrush(Color.Black);
        v.Brush = new SolidColorBrush(Color.White);  // 0 → 255 over 100ms

        clock.Tick(50);  // midpoint — currently at 127.5 grey.

        // Re-target to fully red. New animation: From = 127.5 grey,
        // To = (255, 0, 0).
        v.Brush = new SolidColorBrush(Color.Red);
        clock.Tick(50);
        // Midpoint of (127.5, 127.5, 127.5) → (255, 0, 0):
        //   R: (127.5 + 255) / 2 = 191.25
        //   G: (127.5 + 0)   / 2 = 63.75
        //   B: (127.5 + 0)   / 2 = 63.75
        const mid = v.Brush;
        assert.equal(mid.Color.R, 191.25);
        assert.equal(mid.Color.G, 63.75);
        assert.equal(mid.Color.B, 63.75);
        clock.Tick(50);
        const end = v.Brush;
        assert.equal(end.Color.R, 255);
        assert.equal(end.Color.G, 0);
        assert.equal(end.Color.B, 0);
    });
});
