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
    Thickness,
    Element,
    Visual,
} from '../index.js';
import { resolveKey } from '../model-internals.js';

// Lightweight Visual subclass with three differently-typed DPs so the
// type-dispatch path is exercised end-to-end. The number DP is what most
// real-world use cases need (Height / Width / FontSize); Color +
// Thickness round out the supported interpolators.
class TransitionTest extends Element
{
    static
    {
        MuralBase.RegisterProperty(TransitionTest, 'Number',    0,                MetaData.None);
        MuralBase.RegisterProperty(TransitionTest, 'Color',     Color.Black,      MetaData.None);
        MuralBase.RegisterProperty(TransitionTest, 'Thickness', new Thickness(0), MetaData.None);
        // String DP — used to verify "unanimatable type → snap" fallthrough.
        MuralBase.RegisterProperty(TransitionTest, 'Label',     '',               MetaData.None);
    }
    public get Number():    number    { return this.get_property_value(resolveKey(this, undefined, 'Number')); }
    public set Number(v:    number)   { this.set_property_value(resolveKey(this, undefined, 'Number'), v); }
    public get Color():     Color     { return this.get_property_value(resolveKey(this, undefined, 'Color')); }
    public set Color(v:     Color)    { this.set_property_value(resolveKey(this, undefined, 'Color'), v); }
    public get Thickness(): Thickness { return this.get_property_value(resolveKey(this, undefined, 'Thickness')); }
    public set Thickness(v: Thickness) { this.set_property_value(resolveKey(this, undefined, 'Thickness'), v); }
    public get Label():     string    { return this.get_property_value(resolveKey(this, undefined, 'Label')); }
    public set Label(v:     string)   { this.set_property_value(resolveKey(this, undefined, 'Label'), v); }
}

function freshClock(): ManualClock
{
    AnimationManager.ResetForTests();
    const clock = new ManualClock();
    AnimationManager.Instance.Clock = clock;
    return clock;
}

describe('PropertyTransition — DP shape', () => {
    test('defaults: Property = "", Duration = 300, Easing = Standard', () => {
        const t = new PropertyTransition();
        assert.equal(t.Property, '');
        assert.equal(t.Duration, 300);
        assert.equal(t.Easing,   Easings.Standard);
    });

    test('each DP is settable and roundtrips', () => {
        const t = new PropertyTransition();
        t.Property = 'Height';
        t.Duration = 500;
        t.Easing   = Easings.EmphasizedDecelerate;
        assert.equal(t.Property, 'Height');
        assert.equal(t.Duration, 500);
        assert.equal(t.Easing,   Easings.EmphasizedDecelerate);
    });
});

describe('Visual.Transitions — collection plumbing', () => {
    test('starts undefined; EnsureTransitions allocates an empty collection', () => {
        const v = new TransitionTest();
        // Direct DP read returns undefined when nothing has touched
        // Transitions yet — zero-cost when no transitions are used.
        // The bare getter returns the same (§ 1.16 — no side-effecting
        // read).
        assert.equal(
            v.get_property_value(resolveKey(v, undefined, 'Transitions')),
            undefined,
        );
        assert.equal(v.Transitions, undefined);
        // EnsureTransitions promotes the slot to an empty collection.
        assert.equal(v.EnsureTransitions().Count, 0);
        // Same instance on subsequent reads (no second alloc).
        const first = v.EnsureTransitions();
        assert.equal(v.Transitions, first);
        assert.equal(v.EnsureTransitions(), first);
    });

    test('Add a PropertyTransition; the collection observes the push', () => {
        const v = new TransitionTest();
        const t = new PropertyTransition();
        t.Property = 'Number';
        t.Duration = 200;
        v.EnsureTransitions().Add(t);
        assert.equal(v.Transitions!.Count, 1);
        assert.equal(v.Transitions!.Get(0), t);
    });
});

describe('Implicit transition — number DP', () => {
    let clock: ManualClock;
    beforeEach(() => { clock = freshClock(); });

    test('matched DP write fires an animation from old → new value', () => {
        const v = new TransitionTest();
        const t = new PropertyTransition();
        t.Property = 'Number';
        t.Duration = 100;
        t.Easing   = Easings.Linear;
        v.EnsureTransitions().Add(t);

        v.Number = 0;
        v.Number = 100;  // triggers transition; first tick snaps Number to 0 (the From).

        // The first AdvanceTo(0) inside Storyboard.Begin already wrote
        // the From value to the Animated tier — so the effective value
        // is already the start of the animation, not the just-written
        // new value.
        assert.equal(v.Number, 0, 'at t=0 the animated From snaps the effective value back to oldValue');

        // Halfway through the 100ms duration → linear interpolation = 50.
        clock.Tick(50);
        assert.equal(v.Number, 50);

        // End → 100. HoldEnd pins at 100 even after the storyboard
        // transitions to Filling.
        clock.Tick(50);
        assert.equal(v.Number, 100);
    });

    test('unmatched DP write snaps (no animation)', () => {
        const v = new TransitionTest();
        const t = new PropertyTransition();
        t.Property = 'Number';
        t.Duration = 100;
        v.EnsureTransitions().Add(t);

        v.Color = Color.Red;  // different DP; no matching transition.
        assert.equal(v.Color, Color.Red, 'unmatched DP should snap to the new value immediately');
    });

    test('zero-duration transition snaps (no animation)', () => {
        const v = new TransitionTest();
        const t = new PropertyTransition();
        t.Property = 'Number';
        t.Duration = 0;  // explicit "no animation"
        v.EnsureTransitions().Add(t);

        v.Number = 50;
        assert.equal(v.Number, 50, 'Duration = 0 should snap');
    });

    test('re-write during animation cancels prior, starts fresh from current', () => {
        const v = new TransitionTest();
        const t = new PropertyTransition();
        t.Property = 'Number';
        t.Duration = 100;
        t.Easing   = Easings.Linear;
        v.EnsureTransitions().Add(t);

        v.Number = 0;
        v.Number = 100;  // first transition: 0 → 100 over 100ms.
        clock.Tick(50);
        assert.equal(v.Number, 50);

        // Re-write mid-animation — cancel and restart 50 → 200.
        v.Number = 200;
        // First evaluation inside Begin captures the new From (50).
        assert.equal(v.Number, 50);
        clock.Tick(50);
        assert.equal(v.Number, 125);  // halfway from 50 → 200
        clock.Tick(50);
        assert.equal(v.Number, 200);
    });

    test('writing the same value is a no-op (no animation kicks in)', () => {
        const v = new TransitionTest();
        const t = new PropertyTransition();
        t.Property = 'Number';
        t.Duration = 100;
        v.EnsureTransitions().Add(t);

        v.Number = 50;
        clock.Tick(100);  // any pending animation should finish.
        v.Number = 50;    // identity write — no transition.
        assert.equal(v.Number, 50);
    });
});

describe('Implicit transition — type dispatch', () => {
    let clock: ManualClock;
    beforeEach(() => { clock = freshClock(); });

    test('Color DP animates through ColorAnimation', () => {
        const v = new TransitionTest();
        const t = new PropertyTransition();
        t.Property = 'Color';
        t.Duration = 100;
        t.Easing   = Easings.Linear;
        v.EnsureTransitions().Add(t);

        v.Color = Color.Black;
        v.Color = Color.White;
        assert.deepEqual(v.Color, Color.Black, 'Color animation should snap effective back to From at t=0');
        clock.Tick(50);
        // Linear midpoint of black (0) → white (255) = 127.5 per channel.
        const mid = v.Color;
        assert.equal(mid.R, 127.5);
        assert.equal(mid.G, 127.5);
        assert.equal(mid.B, 127.5);
        clock.Tick(50);
        assert.deepEqual(v.Color, Color.White);
    });

    test('Thickness DP animates through ThicknessAnimation', () => {
        const v = new TransitionTest();
        const t = new PropertyTransition();
        t.Property = 'Thickness';
        t.Duration = 100;
        t.Easing   = Easings.Linear;
        v.EnsureTransitions().Add(t);

        v.Thickness = new Thickness(0);
        v.Thickness = new Thickness(40);
        assert.equal(v.Thickness.Left, 0, 'Thickness animation snaps to From at t=0');
        clock.Tick(50);
        assert.equal(v.Thickness.Left, 20);
        clock.Tick(50);
        assert.equal(v.Thickness.Left, 40);
    });

    test('unanimatable type (string) snaps even with a matching transition', () => {
        const v = new TransitionTest();
        const t = new PropertyTransition();
        t.Property = 'Label';
        t.Duration = 100;
        v.EnsureTransitions().Add(t);

        v.Label = 'hello';
        v.Label = 'world';  // strings aren't animatable; the engine returns
                            // false and the snap-through stands.
        assert.equal(v.Label, 'world');
    });
});
