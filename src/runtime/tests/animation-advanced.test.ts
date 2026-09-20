import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    AnimationManager,
    Color,
    ColorAnimationUsingKeyFrames,
    DiscreteDoubleKeyFrame,
    DoubleAnimation,
    DoubleAnimationUsingKeyFrames,
    LinearColorKeyFrame,
    LinearDoubleKeyFrame,
    LinearThicknessKeyFrame,
    ManualClock,
    MetaData,
    MuralBase,
    Storyboard,
    StoryboardState,
    Thickness,
    ThicknessAnimationUsingKeyFrames,
    Element,
    Visual,
} from '../index.js';
import { resolveKey } from '../model-internals.js';

class AnimTest extends Element
{
    static
    {
        MuralBase.RegisterProperty(AnimTest, 'Number',    0,                MetaData.None);
        MuralBase.RegisterProperty(AnimTest, 'Color',     Color.Black,      MetaData.None);
        MuralBase.RegisterProperty(AnimTest, 'Thickness', new Thickness(0), MetaData.None);
    }
    public get Number(): number { return this.get_property_value(resolveKey(this, undefined, 'Number')); }
    public set Number(v: number) { this.set_property_value(resolveKey(this, undefined, 'Number'), v); }
    public get Color(): Color { return this.get_property_value(resolveKey(this, undefined, 'Color')); }
    public set Color(v: Color) { this.set_property_value(resolveKey(this, undefined, 'Color'), v); }
    public get Thickness(): Thickness { return this.get_property_value(resolveKey(this, undefined, 'Thickness')); }
    public set Thickness(v: Thickness) { this.set_property_value(resolveKey(this, undefined, 'Thickness'), v); }
}

function freshClock(): ManualClock
{
    AnimationManager.ResetForTests();
    const clock = new ManualClock();
    AnimationManager.Instance.Clock = clock;
    return clock;
}

// ── RepeatBehavior ────────────────────────────────────────────────────

describe('RepeatBehavior', () => {
    test('Count=2 plays the animation twice — total active = 2 × Duration', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 0;
        v.BeginAnimation('Number', new DoubleAnimation({
            From: 0, To: 100, Duration: 100, RepeatBehavior: 2,
        }));
        clock.Tick(50);   // iteration 0 mid → 50
        assert.equal(v.Number, 50);
        clock.Tick(50);   // iteration 0 end → 100… but a new iteration just started → 0
        // At exactly t=100, the math says iter 0 has just ended and iter
        // 1 starts at 0. Either reading is defensible; the implementation
        // returns the start-of-iter-1 reading via the % operator.
        assert.equal(v.Number, 0);
        clock.Tick(50);   // iteration 1 mid → 50
        assert.equal(v.Number, 50);
        clock.Tick(50);   // total elapsed 200 → past end (2 iters * 100 = 200)
        // FillBehavior default HoldEnd: pinned at last-frame value.
        // No-AutoReverse + integer count → final progress = 1 → To = 100.
        assert.equal(v.Number, 100);
    });

    test('RepeatBehavior=Infinity never reaches the after phase', () => {
        const clock = freshClock();
        const v = new AnimTest();
        const sb = v.BeginAnimation('Number', new DoubleAnimation({
            From: 0, To: 100, Duration: 100, RepeatBehavior: Number.POSITIVE_INFINITY,
        }));
        clock.Tick(5000);    // 50 iterations
        assert.equal(sb.State, StoryboardState.Running);
        assert.equal(AnimationManager.Instance.ActiveCount, 1);
        sb.Stop();
    });

    test('Fractional RepeatBehavior plays a partial final iteration', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.BeginAnimation('Number', new DoubleAnimation({
            From: 0, To: 100, Duration: 100, RepeatBehavior: 1.5,
        }));
        clock.Tick(150);    // past end of 1.5 iters
        // Total active = 100 × 1.5 = 150; we land exactly at the end of
        // the partial iteration. The half-iteration ended at progress 0.5
        // → value 50.
        assert.equal(v.Number, 50);
    });
});

// ── AutoReverse ────────────────────────────────────────────────────────

describe('AutoReverse', () => {
    test('AutoReverse traverses Forward then Reverse within one iteration', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 0;
        v.BeginAnimation('Number', new DoubleAnimation({
            From: 0, To: 100, Duration: 100, AutoReverse: true,
        }));
        clock.Tick(50);     // forward half → 50% → 50
        assert.equal(v.Number, 50);
        clock.Tick(50);     // peak (end of forward half) → 100
        assert.equal(v.Number, 100);
        clock.Tick(50);     // reverse half → 50% back → 50
        assert.equal(v.Number, 50);
        clock.Tick(50);     // back at From; iteration complete (RepeatBehavior=1)
        // Integer RepeatBehavior + AutoReverse: ends at From = 0.
        assert.equal(v.Number, 0);
    });

    test('AutoReverse + RepeatBehavior=2 = forward-reverse twice', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 0;
        v.BeginAnimation('Number', new DoubleAnimation({
            From: 0, To: 100, Duration: 100,
            AutoReverse: true, RepeatBehavior: 2,
        }));
        clock.Tick(100);    // peak iter 0
        assert.equal(v.Number, 100);
        clock.Tick(100);    // back to start, iter 1 starts
        assert.equal(v.Number, 0);
        clock.Tick(100);    // peak iter 1
        assert.equal(v.Number, 100);
        clock.Tick(100);    // end iter 1 → back at From
        assert.equal(v.Number, 0);
    });

    test('AutoReverse with Infinity loops forever, oscillating between From and To', () => {
        const clock = freshClock();
        const v = new AnimTest();
        const sb = v.BeginAnimation('Number', new DoubleAnimation({
            From: 0, To: 100, Duration: 100,
            AutoReverse: true, RepeatBehavior: Number.POSITIVE_INFINITY,
        }));
        clock.Tick(100);
        assert.equal(v.Number, 100);
        clock.Tick(100);
        assert.equal(v.Number, 0);
        clock.Tick(50);
        assert.equal(v.Number, 50);
        assert.equal(sb.State, StoryboardState.Running);
        sb.Stop();
    });
});

// ── DoubleAnimationUsingKeyFrames ──────────────────────────────────────

describe('DoubleAnimationUsingKeyFrames', () => {
    test('Linear keyframes interpolate between adjacent waypoints', () => {
        const a = new DoubleAnimationUsingKeyFrames({
            KeyFrames: [
                new LinearDoubleKeyFrame({ KeyTime: 100, Value: 10 }),
                new LinearDoubleKeyFrame({ KeyTime: 200, Value: 50 }),
                new LinearDoubleKeyFrame({ KeyTime: 300, Value: 0  }),
            ],
        });
        // Duration auto-derived from max KeyTime.
        assert.equal(a.Duration, 300);
        // Segment 0..100: from baseValue (0) → 10.
        assert.equal(a.Evaluate(50, 0),  5);
        assert.equal(a.Evaluate(100, 0), 10);
        // Segment 100..200: from 10 → 50.
        assert.equal(a.Evaluate(150, 0), 30);
        assert.equal(a.Evaluate(200, 0), 50);
        // Segment 200..300: from 50 → 0.
        assert.equal(a.Evaluate(250, 0), 25);
        assert.equal(a.Evaluate(300, 0), 0);
    });

    test('Discrete keyframes snap to the keyframe value across the segment', () => {
        const a = new DoubleAnimationUsingKeyFrames({
            KeyFrames: [
                new LinearDoubleKeyFrame({   KeyTime: 100, Value: 10 }),
                new DiscreteDoubleKeyFrame({ KeyTime: 200, Value: 99 }),
                new LinearDoubleKeyFrame({   KeyTime: 300, Value: 0  }),
            ],
        });
        // Linear into 10.
        assert.equal(a.Evaluate(100, 0), 10);
        // Inside the discrete segment — value is the discrete keyframe's Value.
        assert.equal(a.Evaluate(150, 0), 99);
        assert.equal(a.Evaluate(200, 0), 99);
        // Linear from 99 → 0 in the next segment.
        assert.equal(a.Evaluate(250, 0), 49.5);
    });

    test('Explicit Duration shorter than max KeyTime clips later keyframes', () => {
        const a = new DoubleAnimationUsingKeyFrames({
            Duration:  100,
            KeyFrames: [
                new LinearDoubleKeyFrame({ KeyTime: 50,  Value: 10 }),
                new LinearDoubleKeyFrame({ KeyTime: 100, Value: 20 }),
                new LinearDoubleKeyFrame({ KeyTime: 200, Value: 99 }),
            ],
        });
        // Within the clipped Duration, the third keyframe isn't visited
        // because progress(t)*Duration maxes at 100 = the second
        // keyframe's KeyTime. The animation ends at Value=20.
        assert.equal(a.Evaluate(100, 0), 20);
        // Past Duration — frozen at the last reached keyframe's Value.
        assert.equal(a.Evaluate(150, 0), 20);
    });

    test('AutoReverse with keyframes walks segments backward through the reverse half', () => {
        const a = new DoubleAnimationUsingKeyFrames({
            KeyFrames: [
                new LinearDoubleKeyFrame({ KeyTime: 100, Value: 100 }),
            ],
            AutoReverse: true,
        });
        // Duration auto = 100; total iter = 200 (forward + reverse).
        assert.equal(a.Evaluate(0,   0), 0);
        assert.equal(a.Evaluate(50,  0), 50);    // forward mid
        assert.equal(a.Evaluate(100, 0), 100);   // forward end
        assert.equal(a.Evaluate(150, 0), 50);    // reverse mid
        assert.equal(a.Evaluate(200, 0), 0);     // reverse end
    });

    test('Empty KeyFrames list returns baseValue at any t', () => {
        const a = new DoubleAnimationUsingKeyFrames({ Duration: 100 });
        assert.equal(a.Evaluate(0,   7), 7);
        assert.equal(a.Evaluate(50,  7), 7);
        assert.equal(a.Evaluate(100, 7), 7);
    });
});

describe('ColorAnimationUsingKeyFrames', () => {
    test('Linear color keyframes blend per channel across segments', () => {
        const a = new ColorAnimationUsingKeyFrames({
            KeyFrames: [
                new LinearColorKeyFrame({
                    KeyTime: 100,
                    Value:   new Color(255, 0, 0, 255),
                }),
                new LinearColorKeyFrame({
                    KeyTime: 200,
                    Value:   new Color(0, 0, 255, 255),
                }),
            ],
        });
        assert.equal(a.Duration, 200);
        const mid1 = a.Evaluate(50, Color.Black);   // base → red, t=0.5
        assert.equal(mid1.R, 127.5);
        assert.equal(mid1.B, 0);
        const mid2 = a.Evaluate(150, Color.Black);  // red → blue, t=0.5
        assert.equal(mid2.R, 127.5);
        assert.equal(mid2.B, 127.5);
    });
});

describe('ThicknessAnimationUsingKeyFrames', () => {
    test('Linear thickness keyframes blend per edge', () => {
        const a = new ThicknessAnimationUsingKeyFrames({
            KeyFrames: [
                new LinearThicknessKeyFrame({
                    KeyTime: 100,
                    Value:   new Thickness(20, 0, 20, 0),
                }),
                new LinearThicknessKeyFrame({
                    KeyTime: 200,
                    Value:   new Thickness(0, 20, 0, 20),
                }),
            ],
        });
        const mid = a.Evaluate(150, new Thickness(0));
        // Segment progress 0.5 between (20, 0, 20, 0) and (0, 20, 0, 20).
        assert.equal(mid.Left,   10);
        assert.equal(mid.Top,    10);
        assert.equal(mid.Right,  10);
        assert.equal(mid.Bottom, 10);
    });
});

// ── Storyboard integration with new features ─────────────────────────

describe('Storyboard — keyframes + repeat / auto-reverse', () => {
    test('Storyboard drives a keyframe animation end-to-end', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 0;
        const a = new DoubleAnimationUsingKeyFrames({
            KeyFrames: [
                new LinearDoubleKeyFrame({ KeyTime: 100, Value: 100 }),
                new LinearDoubleKeyFrame({ KeyTime: 200, Value: 0   }),
            ],
        });
        const sb = new Storyboard();
        sb.Add(v, 'Number', a);
        sb.Begin();
        clock.Tick(100);
        assert.equal(v.Number, 100);
        clock.Tick(100);
        assert.equal(v.Number, 0);
        assert.equal(sb.State, StoryboardState.Filling);
    });

    test('Forever-looping storyboard stays Running and active across many frames', () => {
        const clock = freshClock();
        const v = new AnimTest();
        const sb = v.BeginAnimation('Number', new DoubleAnimation({
            From: 0, To: 1, Duration: 100,
            RepeatBehavior: Number.POSITIVE_INFINITY,
            AutoReverse: true,
        }));
        for (let i = 0; i < 100; i++) clock.Tick(50);  // 5 s of frames
        assert.equal(sb.State, StoryboardState.Running);
        sb.Stop();
    });
});
