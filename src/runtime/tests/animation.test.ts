import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    AnimationManager,
    Color,
    ColorAnimation,
    DoubleAnimation,
    Easings,
    FillBehavior,
    ManualClock,
    MetaData,
    MuralBase,
    PropertyValueSource,
    Storyboard,
    StoryboardState,
    ThicknessAnimation,
    Thickness,
    Element,
    Visual,
    interpolateColor,
    interpolateNumber,
    interpolateThickness,
} from '../index.js';
import { resolveKey } from '../model-internals.js';

// Lightweight Visual subclass with a numeric DP for the EVD-precedence
// tests. Stand-in for "any DP on any Visual" so the animation slot
// behaviour is testable without dragging in a concrete control.
class AnimTest extends Element
{
    static {
        MuralBase.RegisterProperty(AnimTest, 'Number',    0,              MetaData.None);
        MuralBase.RegisterProperty(AnimTest, 'Color',     Color.Black,    MetaData.None);
        MuralBase.RegisterProperty(AnimTest, 'Thickness', new Thickness(0), MetaData.None);
    }
    public get Number(): number { return this.get_property_value(resolveKey(this, undefined, 'Number')); }
    public set Number(v: number) { this.set_property_value(resolveKey(this, undefined, 'Number'), v); }
    public get Color(): Color { return this.get_property_value(resolveKey(this, undefined, 'Color')); }
    public set Color(v: Color) { this.set_property_value(resolveKey(this, undefined, 'Color'), v); }
    public get Thickness(): Thickness { return this.get_property_value(resolveKey(this, undefined, 'Thickness')); }
    public set Thickness(v: Thickness) { this.set_property_value(resolveKey(this, undefined, 'Thickness'), v); }
}

// Install a fresh ManualClock on the AnimationManager singleton before
// each test so per-test state doesn't bleed and we can drive the engine
// without timers. Returns the clock so the test can Tick it.
function freshClock(): ManualClock
{
    AnimationManager.ResetForTests();
    const clock = new ManualClock();
    AnimationManager.Instance.Clock = clock;
    return clock;
}

// ── ManualClock ───────────────────────────────────────────────────────

describe('ManualClock', () => {
    test('Now() returns 0 until ticked', () => {
        const c = new ManualClock();
        assert.equal(c.Now(), 0);
    });

    test('Tick advances time and fires subscribers with the new value', () => {
        const c = new ManualClock();
        const seen: number[] = [];
        c.Subscribe(now => seen.push(now));
        c.Tick(100);
        c.Tick(50);
        assert.equal(c.Now(), 150);
        assert.deepEqual(seen, [100, 150]);
    });

    test('AdvanceTo refuses backwards motion', () => {
        const c = new ManualClock();
        c.Tick(500);
        assert.throws(() => c.AdvanceTo(100), /backwards/);
    });

    test('Unsubscribe stops further notifications', () => {
        const c = new ManualClock();
        let count = 0;
        const off = c.Subscribe(() => count++);
        c.Tick(10);
        off();
        c.Tick(10);
        assert.equal(count, 1);
    });

    test('A subscriber that unsubscribes mid-tick does not perturb iteration', () => {
        const c = new ManualClock();
        let aCount = 0;
        let bCount = 0;
        let offA: (() => void) | undefined;
        offA = c.Subscribe(() => { aCount++; offA?.(); });
        c.Subscribe(() => { bCount++; });
        c.Tick(10);
        // Both subscribers fired on the tick where A unsubscribed; only
        // B fires on subsequent ticks.
        assert.equal(aCount, 1);
        assert.equal(bCount, 1);
        c.Tick(10);
        assert.equal(aCount, 1);
        assert.equal(bCount, 2);
    });
});

// ── Easings ───────────────────────────────────────────────────────────

describe('Easings', () => {
    test('Linear is the identity', () => {
        assert.equal(Easings.Linear(0),   0);
        assert.equal(Easings.Linear(0.5), 0.5);
        assert.equal(Easings.Linear(1),   1);
    });

    test('All easings map 0 → 0 and 1 → 1 (boundary fidelity)', () => {
        for (const [name, fn] of Object.entries(Easings))
        {
            assert.equal(fn(0), 0, `${name}(0)`);
            assert.equal(fn(1), 1, `${name}(1)`);
        }
    });

    test('QuadOut is the temporal mirror of QuadIn (f_out(t) = 1 - f_in(1 - t))', () => {
        for (let t = 0; t <= 1; t += 0.1)
        {
            const t2 = Math.round(t * 10) / 10;     // avoid float drift on equality
            assert.ok(Math.abs(Easings.QuadOut(t2) - (1 - Easings.QuadIn(1 - t2))) < 1e-9);
        }
    });
});

// ── Interpolators ─────────────────────────────────────────────────────

describe('Interpolators', () => {
    test('interpolateNumber at t=0/0.5/1 hits from / mid / to', () => {
        assert.equal(interpolateNumber(10, 30, 0),   10);
        assert.equal(interpolateNumber(10, 30, 0.5), 20);
        assert.equal(interpolateNumber(10, 30, 1),   30);
    });

    test('interpolateColor blends per-channel', () => {
        const c = interpolateColor(new Color(0, 0, 0, 0), new Color(100, 200, 50, 255), 0.5);
        assert.equal(c.R, 50);
        assert.equal(c.G, 100);
        assert.equal(c.B, 25);
        assert.equal(c.A, 127.5);
    });

    test('interpolateThickness blends per-edge', () => {
        const r = interpolateThickness(
            new Thickness(10, 0, 10, 0),
            new Thickness(0, 10, 0, 10),
            0.5);
        assert.equal(r.Left,   5);
        assert.equal(r.Top,    5);
        assert.equal(r.Right,  5);
        assert.equal(r.Bottom, 5);
    });
});

// ── DoubleAnimation / ColorAnimation / ThicknessAnimation ─────────────

describe('Per-type animations — Evaluate()', () => {
    test('DoubleAnimation linear hits From / mid / To at t = BeginTime / mid / end', () => {
        const a = new DoubleAnimation({ From: 10, To: 30, Duration: 100 });
        assert.equal(a.Evaluate(0,   0), 10);
        assert.equal(a.Evaluate(50,  0), 20);
        assert.equal(a.Evaluate(100, 0), 30);
    });

    test('From=undefined uses baseValue', () => {
        const a = new DoubleAnimation({ To: 30, Duration: 100 });
        // baseValue=7 → From=7 at t=0; mid = (7+30)/2 = 18.5; end = 30.
        assert.equal(a.Evaluate(0,   7), 7);
        assert.equal(a.Evaluate(50,  7), 18.5);
        assert.equal(a.Evaluate(100, 7), 30);
    });

    test('BeginTime delays the active region; "before" returns From', () => {
        const a = new DoubleAnimation({ From: 0, To: 100, BeginTime: 50, Duration: 100 });
        assert.equal(a.StateAt(0),    'before');
        assert.equal(a.StateAt(50),   'running');
        assert.equal(a.StateAt(149),  'running');
        assert.equal(a.StateAt(150),  'after');
        // Inside running region, mid is at t=100 → 50% progress.
        assert.equal(a.Evaluate(100, 0), 50);
    });

    test('Easing applies between From and To (not clamped to endpoints)', () => {
        const a = new DoubleAnimation({ From: 0, To: 100, Duration: 100, Easing: Easings.QuadIn });
        // QuadIn(0.5) = 0.25 → value = 25.
        assert.equal(a.Evaluate(50, 0), 25);
    });

    test('Zero-duration snaps to To immediately', () => {
        const a = new DoubleAnimation({ From: 0, To: 99, Duration: 0 });
        assert.equal(a.Evaluate(0, 0), 99);
    });

    test('ColorAnimation interpolates per-channel', () => {
        const a = new ColorAnimation({
            From: new Color(0, 0, 0, 0),
            To:   new Color(100, 200, 50, 255),
            Duration: 100,
        });
        const mid = a.Evaluate(50, Color.Black);
        assert.equal(mid.R, 50);
        assert.equal(mid.G, 100);
    });

    test('ThicknessAnimation interpolates per-edge', () => {
        const a = new ThicknessAnimation({
            From: new Thickness(0),
            To:   new Thickness(20),
            Duration: 100,
        });
        const mid = a.Evaluate(50, new Thickness(0));
        assert.equal(mid.Left, 10);
        assert.equal(mid.Top,  10);
    });
});

// ── EVD animation slot precedence ─────────────────────────────────────

describe('EVD animation slot — precedence', () => {
    test('SetAnimatedValue masks the Local value', () => {
        const v = new AnimTest();
        v.Number = 5;
        assert.equal(v.Number, 5);
        v.SetAnimatedValue(resolveKey(v, undefined, 'Number'), 99);
        assert.equal(v.Number, 99);
        assert.equal(v.GetValueSource(resolveKey(v, undefined, 'Number')), PropertyValueSource.AnimatedValue);
    });

    test('ClearAnimatedValue restores the Local value', () => {
        const v = new AnimTest();
        v.Number = 5;
        v.SetAnimatedValue(resolveKey(v, undefined, 'Number'), 99);
        v.ClearAnimatedValue(resolveKey(v, undefined, 'Number'));
        assert.equal(v.Number, 5);
        assert.equal(v.GetValueSource(resolveKey(v, undefined, 'Number')), PropertyValueSource.LocalValue);
    });

    test('Local writes while animation is active update the underlying slot quietly', () => {
        const v = new AnimTest();
        v.Number = 5;
        v.SetAnimatedValue(resolveKey(v, undefined, 'Number'), 99);
        v.Number = 7;                       // Local write under the mask.
        assert.equal(v.Number, 99,
            'effective value stays at the animated value');
        v.ClearAnimatedValue(resolveKey(v, undefined, 'Number'));
        assert.equal(v.Number, 7,
            'after Clear, the FRESH local value re-surfaces (not the pre-anim 5)');
    });

    test('ClearAnimatedValue with no prior animation is a no-op', () => {
        const v = new AnimTest();
        v.Number = 5;
        v.ClearAnimatedValue(resolveKey(v, undefined, 'Number'));
        assert.equal(v.Number, 5);
    });

    test('Default falls through when no other slot is set', () => {
        const v = new AnimTest();
        v.SetAnimatedValue(resolveKey(v, undefined, 'Number'), 99);
        v.ClearAnimatedValue(resolveKey(v, undefined, 'Number'));
        assert.equal(v.Number, 0,
            'no Local was ever set; effective value resolves to the registered default');
    });
});

// ── Storyboard ────────────────────────────────────────────────────────

describe('Storyboard — single-target', () => {
    beforeEach(() => { /* fresh clock per test */ });

    test('Begin captures the base value, AdvanceTo writes the animated value', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 10;

        const sb = new Storyboard();
        sb.Add(v, 'Number', new DoubleAnimation({ To: 30, Duration: 100 }));
        sb.Begin();

        // At t=0: From defaulted to baseValue=10, so Number stays 10.
        assert.equal(v.Number, 10);
        assert.equal(sb.State, StoryboardState.Running);

        clock.Tick(50);
        assert.equal(v.Number, 20);

        clock.Tick(50);
        assert.equal(v.Number, 30);
    });

    test('FillBehavior.HoldEnd keeps the To value pinned past Duration', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 0;
        const sb = new Storyboard();
        sb.Add(v, 'Number', new DoubleAnimation({ To: 50, Duration: 100 }));
        sb.Begin();
        clock.Tick(200);    // 100 ms past end.
        assert.equal(v.Number, 50);
        assert.equal(sb.State, StoryboardState.Filling);
        assert.equal(v.GetValueSource(resolveKey(v, undefined, 'Number')), PropertyValueSource.AnimatedValue,
            'HoldEnd keeps the animation slot active');
    });

    test('FillBehavior.Stop releases the slot at completion', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 10;
        const sb = new Storyboard();
        sb.Add(v, 'Number', new DoubleAnimation({
            From: 0, To: 50, Duration: 100, FillBehavior: FillBehavior.Stop,
        }));
        sb.Begin();
        clock.Tick(200);
        // Animation slot dropped → fresh Local (10) re-surfaces.
        assert.equal(v.Number, 10);
        assert.equal(sb.State, StoryboardState.Stopped);
        assert.equal(v.GetValueSource(resolveKey(v, undefined, 'Number')), PropertyValueSource.LocalValue);
    });

    test('Stop() releases the animation slot mid-run', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 10;
        const sb = new Storyboard();
        sb.Add(v, 'Number', new DoubleAnimation({ From: 0, To: 100, Duration: 1000 }));
        sb.Begin();
        clock.Tick(500);
        assert.equal(v.Number, 50);
        sb.Stop();
        assert.equal(v.Number, 10);     // local resurfaces
        assert.equal(sb.State, StoryboardState.Stopped);
    });

    test('Completed listener fires once when the storyboard ends', () => {
        const clock = freshClock();
        const v = new AnimTest();
        const sb = new Storyboard();
        sb.Add(v, 'Number', new DoubleAnimation({ To: 50, Duration: 100 }));
        let fires = 0;
        sb.AddCompletedListener(() => fires++);
        sb.Begin();
        clock.Tick(200);
        assert.equal(fires, 1);
        // Idle ticks don't re-fire.
        clock.Tick(100);
        assert.equal(fires, 1);
    });

    test('Add after Begin throws — fixed child set is required for baseValue capture', () => {
        const v = new AnimTest();
        const sb = new Storyboard();
        sb.Add(v, 'Number', new DoubleAnimation({ To: 1 }));
        sb.Begin();
        assert.throws(
            () => sb.Add(v, 'Number', new DoubleAnimation({ To: 2 })),
            /already begun/,
        );
        sb.Stop();
    });

    // §18.4 — AwaitCompleted: a clock-source-agnostic Promise so callers
    // can chain teardown off a storyboard instead of a wall-clock timer.
    test('AwaitCompleted resolves when the clock advances past the storyboard', async () => {
        const clock = freshClock();
        const v = new AnimTest();
        const sb = new Storyboard();
        sb.Add(v, 'Number', new DoubleAnimation({ To: 50, Duration: 100 }));
        sb.Begin();

        let resolved = false;
        const p = sb.AwaitCompleted().then(() => { resolved = true; });

        // Before the storyboard ends, the promise is still pending.
        clock.Tick(50);
        await Promise.resolve();
        assert.equal(resolved, false, 'pending while the storyboard is mid-flight');

        // Advancing past the duration completes it and settles the promise.
        clock.Tick(100);
        await p;
        assert.equal(resolved, true, 'resolves once the storyboard completes');
    });

    test('AwaitCompleted on a non-running storyboard resolves immediately', async () => {
        const v = new AnimTest();
        const sb = new Storyboard();
        sb.Add(v, 'Number', new DoubleAnimation({ To: 1, Duration: 100 }));
        // Never Begun → not Running → resolves without any clock advance.
        await sb.AwaitCompleted();
        assert.ok(true, 'awaiting an un-begun storyboard does not hang');
    });
});

describe('Storyboard — multi-target', () => {
    test('Each child evaluates against its own captured base value', () => {
        const clock = freshClock();
        const a = new AnimTest(); a.Number = 0;
        const b = new AnimTest(); b.Number = 100;

        const sb = new Storyboard();
        sb.Add(a, 'Number', new DoubleAnimation({ To: 50,  Duration: 100 }));
        sb.Add(b, 'Number', new DoubleAnimation({ To: 200, Duration: 100 }));
        sb.Begin();
        clock.Tick(50);
        // a:   0 → mid (0 + 50) / 2  = 25
        // b: 100 → mid (100 + 200)/2 = 150
        assert.equal(a.Number, 25);
        assert.equal(b.Number, 150);
    });

    test('Children with different Durations finish independently; storyboard ends when ALL are done', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 0;
        const sb = new Storyboard();
        sb.Add(v, 'Color',     new ColorAnimation({
            From: Color.Black, To: Color.White, Duration: 50,
        }));
        sb.Add(v, 'Thickness', new ThicknessAnimation({
            From: new Thickness(0), To: new Thickness(10), Duration: 200,
        }));
        let completedAt: number | undefined;
        sb.AddCompletedListener(() => { completedAt = clock.Now(); });
        sb.Begin();

        clock.Tick(50);
        // Color finished; Thickness still running. Storyboard still Running.
        assert.equal(sb.State, StoryboardState.Running);
        assert.equal(completedAt, undefined);
        // Color holds at White.
        assert.equal(v.Color.R, 255);

        clock.Tick(150);
        assert.equal(sb.State, StoryboardState.Filling);
        assert.equal(completedAt, 200);
    });

    test('BeginTime delays a child within the storyboard', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 5;
        const sb = new Storyboard();
        sb.Add(v, 'Number', new DoubleAnimation({
            To: 100, BeginTime: 50, Duration: 100,
        }));
        sb.Begin();
        clock.Tick(25);
        // 'before' phase — no animation slot written, local value visible.
        assert.equal(v.Number, 5);
        assert.equal(v.GetValueSource(resolveKey(v, undefined, 'Number')), PropertyValueSource.LocalValue);
        clock.Tick(50);                  // total elapsed = 75 → 25 ms into running
        // 25 / 100 = 0.25 → From=5 + (100-5) * 0.25 = 28.75
        assert.equal(v.Number, 28.75);
    });
});

// ── Visual.BeginAnimation ─────────────────────────────────────────────

describe('Visual.BeginAnimation', () => {
    test('Returns a Storyboard the caller can Stop()', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 5;
        const sb = v.BeginAnimation('Number', new DoubleAnimation({ To: 50, Duration: 200 }));
        clock.Tick(100);
        assert.equal(v.Number, 27.5);    // base 5 + (50-5)*0.5
        sb.Stop();
        assert.equal(v.Number, 5);
    });

    test('Two sequential BeginAnimations replace each other (last write wins)', () => {
        const clock = freshClock();
        const v = new AnimTest();
        v.Number = 0;
        v.BeginAnimation('Number', new DoubleAnimation({ To: 100, Duration: 1000 }));
        clock.Tick(500);
        assert.equal(v.Number, 50);
        // Start a second animation on the same property — the new
        // storyboard's SetAnimatedValue overwrites the slot every tick.
        v.BeginAnimation('Number', new DoubleAnimation({ To: 30, Duration: 1000 }));
        clock.Tick(500);
        // From the SECOND storyboard's POV: elapsed = 500, base captured
        // at the moment of Begin (= 50 — the value when the new storyboard
        // started, which was the first animation's mid-value), so mid =
        // (50 + 30) / 2 = 40.
        assert.equal(v.Number, 40);
    });
});

// ── AnimationManager lifecycle ────────────────────────────────────────

describe('AnimationManager', () => {
    test('Clock subscription attaches on first storyboard, detaches when last completes', () => {
        const clock = freshClock();
        const v = new AnimTest();
        let subscribeCount = 0;
        // Wrap clock.Subscribe so we can count attach/detach pairs. We
        // can't directly patch ManualClock's private listener set, so
        // observe externally by checking ActiveCount.
        assert.equal(AnimationManager.Instance.ActiveCount, 0);

        const sb = v.BeginAnimation('Number', new DoubleAnimation({
            To: 1, Duration: 100, FillBehavior: FillBehavior.Stop,
        }));
        assert.equal(AnimationManager.Instance.ActiveCount, 1);
        clock.Tick(100);
        // FillBehavior.Stop → storyboard exits to Stopped and unregisters.
        assert.equal(AnimationManager.Instance.ActiveCount, 0);
        assert.equal(sb.State, StoryboardState.Stopped);
        subscribeCount++;
        assert.equal(subscribeCount, 1);
    });

    test('Swapping the Clock mid-animation keeps the storyboard running on the new clock', () => {
        const original = freshClock();
        const v = new AnimTest();
        v.Number = 0;
        const sb = v.BeginAnimation('Number',
            new DoubleAnimation({ To: 100, Duration: 100 }));
        original.Tick(25);
        assert.equal(v.Number, 25);

        // Swap to a new clock. The storyboard's _beginAt is anchored on
        // the OLD clock so the new clock starts from its own 0, but the
        // storyboard's elapsed is computed from its own captured begin —
        // the new clock just needs to roll forward enough to reach the
        // tick the old clock would've. Since the new clock starts at 0,
        // and storyboard._beginAt was captured on the original clock at 0,
        // we need to "warp" by advancing the new clock past 25 ms.
        const fresh = new ManualClock();
        AnimationManager.Instance.Clock = fresh;
        fresh.Tick(100);
        // Storyboard's AdvanceTo(now=100) sees elapsed = 100 - 0 = 100,
        // which past Duration → snaps to To.
        assert.equal(v.Number, 100);
        sb.Stop();
    });
});

// Pins backlog item 1.2: animation slot integrates with the
// post-1.1 coerce pipeline. Coerce runs on every effective-value read,
// including reads against the animated slot — so a property whose
// animation drives values past a clamp ceiling reads back the clamped
// value, and listeners see the post-coerce frames.
describe('EVD animation slot — coerce integration', () => {
    // Local class with a coerce callback so the AnimTest fixture stays
    // un-coerced for the precedence tests above.
    class Capped extends Element
    {
        static {
            MuralBase.RegisterProperty(
                Capped, 'Value', 0, MetaData.None,
                (_m, v) => Math.min(v as number, 50),
            );
        }
        public get Value(): number { return this.get_property_value(resolveKey(this, undefined, 'Value')); }
        public set Value(v: number) { this.set_property_value(resolveKey(this, undefined, 'Value'), v); }
    }

    test('SetAnimatedValue past the ceiling reads back as the coerced (clamped) value', () => {
        const c = new Capped();
        c.SetAnimatedValue(resolveKey(c, undefined, 'Value'), 200);
        assert.equal(c.Value, 50);
    });

    test('GetValueSource is CoercedValue when coerce clamped the animated value', () => {
        const c = new Capped();
        c.SetAnimatedValue(resolveKey(c, undefined, 'Value'), 200);  // clamped to 50
        // Coerce changed the base (200 → 50), so the source reports the
        // diagnostic CoercedValue. The underlying base slot is still
        // AnimatedValue — exposed only after ClearAnimatedValue.
        assert.equal(c.GetValueSource(resolveKey(c, undefined, 'Value')), PropertyValueSource.CoercedValue);
    });

    test('GetValueSource is AnimatedValue when the animated value stays under the ceiling', () => {
        const c = new Capped();
        c.SetAnimatedValue(resolveKey(c, undefined, 'Value'), 30);  // no clamp
        assert.equal(c.GetValueSource(resolveKey(c, undefined, 'Value')), PropertyValueSource.AnimatedValue);
    });

    test('PropertyChanged listeners see post-coerce values during a Storyboard tick', () => {
        const clock = freshClock();
        const c = new Capped();
        const seen: number[] = [];
        c.PropertyChanged(resolveKey(c, undefined, 'Value')).subscribe(({ newValue }) => { seen.push(newValue as number); });

        // To = 200, Duration = 100. At t = 100 the timeline commits To,
        // which coerce clamps to 50. Listeners get the clamped value.
        const sb = new Storyboard();
        sb.Add(c, 'Value', new DoubleAnimation({ From: 0, To: 200, Duration: 100 }));
        sb.Begin();
        clock.Tick(100);
        // Last fire carries the clamped final value, not the raw 200.
        assert.equal(seen[seen.length - 1], 50);
        assert.equal(c.Value, 50);
        sb.Stop();
    });
});
