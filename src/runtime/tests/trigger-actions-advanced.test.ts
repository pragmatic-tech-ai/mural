import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    AnimationManager,
    Application,
    BeginStoryboardAction,
    DoubleAnimation,
    Element,
    EventTrigger,
    ManualClock,
    MetaData,
    MuralBase,
    PropertyTrigger,
    Setter,
    Storyboard,
    Style,
    Visual,
} from '../index.js';
import { resolveKey } from '../model-internals.js';
import { Border } from '../../basic/border.js';

function freshClock(): ManualClock
{
    AnimationManager.ResetForTests();
    const c = new ManualClock();
    AnimationManager.Instance.Clock = c;
    return c;
}

// Lightweight Element subclass with a bool DP so we can flip a trigger
// without dragging in a control. The base Element / MuralBase machinery is
// what we're actually exercising.
class TriggerTest extends Element
{
    static
    {
        MuralBase.RegisterProperty(TriggerTest, 'Active', false, MetaData.None);
        MuralBase.RegisterProperty(TriggerTest, 'Width',  0,     MetaData.Arrange);
    }
    public get Active(): boolean { return this.get_property_value(resolveKey(this, undefined, 'Active')); }
    public set Active(v: boolean) { this.set_property_value(resolveKey(this, undefined, 'Active'), v); }
    public get Width(): number { return this.get_property_value(resolveKey(this, undefined, 'Width')); }
    public set Width(v: number) { this.set_property_value(resolveKey(this, undefined, 'Width'), v); }
}

// ── PropertyTrigger enter / exit actions ──────────────────────────────

describe('PropertyTrigger enter / exit actions', () => {
    beforeEach(() => { Application.current = null; });

    test('Enter action fires on activation edge; exit fires on deactivation edge', () => {
        const clock = freshClock();
        const t = new TriggerTest();

        let enterCalls = 0;
        let exitCalls  = 0;
        const enterAction = new BeginStoryboardAction((target) => {
            enterCalls++;
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ To: 100, Duration: 100 }));
            return sb;
        });
        const exitAction = new BeginStoryboardAction((target) => {
            exitCalls++;
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ To: 0, Duration: 100 }));
            return sb;
        });
        const trigger = new PropertyTrigger(
            TriggerTest, 'Active', true,
            [],            // no setters
            [enterAction],
            [exitAction],
        );

        const style = new Style(TriggerTest, [], undefined, [trigger]);
        t.Style = style;

        // Initial state: Active=false → trigger inactive → no action yet.
        assert.equal(enterCalls, 0);
        assert.equal(exitCalls,  0);

        // Flip Active=true → trigger activates → enter fires once.
        t.Active = true;
        assert.equal(enterCalls, 1, 'enter fires once on activation');
        assert.equal(exitCalls,  0);

        // Idempotent re-activations (writing the same value) do NOT
        // re-fire enter — _activeTriggers already contains it.
        t.Active = true;
        assert.equal(enterCalls, 1, 'no re-fire on same-value write');

        // Flip Active=false → trigger deactivates → exit fires once.
        t.Active = false;
        assert.equal(exitCalls, 1);

        // Drive the clock so the enter-action's storyboard ticks.
        // (The animation slot was set when the action fired; we're
        // verifying the runtime fully wired enter/exit, not the
        // animation engine.)
        clock.Tick(100);
        assert.equal(AnimationManager.Instance.ActiveCount, 0,
            'all storyboards completed (single Tick covered both 100ms animations)');
    });

    test('Enter actions DO NOT fire on style apply when the property already matches', () => {
        const t = new TriggerTest();
        t.Active = true;

        let enterCalls = 0;
        const enterAction = new BeginStoryboardAction((target) => {
            enterCalls++;
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ To: 100, Duration: 100 }));
            return sb;
        });
        const trigger = new PropertyTrigger(
            TriggerTest, 'Active', true,
            [], [enterAction], [],
        );

        // WPF parity: applying a Style whose PropertyTrigger condition
        // is ALREADY satisfied applies the SETTERS but doesn't fire
        // EnterActions — the activation is an "initial state" not a
        // "transition". The runtime's _activeTriggers add still occurs
        // (so the trigger is correctly active state), but no edge.
        const style = new Style(TriggerTest, [], undefined, [trigger]);
        freshClock();
        t.Style = style;
        assert.equal(enterCalls, 0,
            'initial-state match is NOT a transition; enterActions stay dormant');

        // A subsequent false→true transition IS an edge — fires.
        t.Active = false;
        t.Active = true;
        assert.equal(enterCalls, 1,
            'genuine false→true transition fires enterActions');
    });

    test('Exit actions DO NOT fire on style detach when the trigger was active', () => {
        const t = new TriggerTest();
        t.Active = true;

        let exitCalls = 0;
        const exitAction = new BeginStoryboardAction((target) => {
            exitCalls++;
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ To: 0, Duration: 50 }));
            return sb;
        });
        const trigger = new PropertyTrigger(
            TriggerTest, 'Active', true,
            [], [], [exitAction],
        );

        const style = new Style(TriggerTest, [], undefined, [trigger]);
        freshClock();
        t.Style = style;
        // Symmetric to the enter case: detaching a Style whose trigger
        // is currently active unapplies setters silently — uninstall is
        // not a deactivation edge, just a teardown. Genuine true→false
        // property transitions are the only thing that fires exitActions.
        t.Style = undefined;
        assert.equal(exitCalls, 0,
            'Style detach is not a deactivation edge; exitActions stay dormant');
    });
});

// ── Routed-event listeners + PointerDown EventTrigger ──────────────────

describe('Routed event listeners + EventTrigger', () => {
    beforeEach(() => { Application.current = null; });

    test('AddRoutedEventListener / RemoveRoutedEventListener round-trip', () => {
        const v = new TriggerTest();
        const events: unknown[] = [];
        const listener = (args: unknown): void => { events.push(args); };
        v.AddRoutedEventListener('PointerDown', listener);
        v.FireRoutedListeners('PointerDown', { kind: 'fake' });
        assert.deepEqual(events, [{ kind: 'fake' }]);
        v.RemoveRoutedEventListener('PointerDown', listener);
        v.FireRoutedListeners('PointerDown', { kind: 'second' });
        assert.equal(events.length, 1, 'no events after remove');
    });

    test('EventTrigger on PointerDown invokes actions when the dispatcher fires the event', () => {
        const v = new TriggerTest();
        let invokes = 0;
        const action = new BeginStoryboardAction((target) => {
            invokes++;
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ To: 100, Duration: 50 }));
            return sb;
        });
        v.AddEventTrigger(new EventTrigger('PointerDown', [action]));

        freshClock();
        // Simulate the dispatcher's bubble-phase listener fire.
        v.FireRoutedListeners('PointerDown', { kind: 'pointer-down' });
        assert.equal(invokes, 1);
    });

    test('Loaded EventTrigger fires once when the Visual attaches to a target', () => {
        const v = new TriggerTest();
        let invokes = 0;
        const action = new BeginStoryboardAction((target) => {
            invokes++;
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ To: 100, Duration: 50 }));
            return sb;
        });
        v.AddEventTrigger(new EventTrigger('Loaded', [action]));
        // No attach yet → no fire.
        assert.equal(invokes, 0);

        // Attach by setting a parent Border (which propagates target).
        // For this test we just simulate via the protected SetTarget,
        // reached through the cast escape hatch since fixtures don't
        // need a real target.
        (v as unknown as { SetTarget: (t: unknown) => void })
            .SetTarget({ /* minimal host stub */ } as unknown);
        assert.equal(invokes, 1, 'Loaded fires on attach');

        // Subsequent detach + re-attach does NOT re-fire (one-shot).
        (v as unknown as { SetTarget: (t: unknown) => void })
            .SetTarget(undefined);
        (v as unknown as { SetTarget: (t: unknown) => void })
            .SetTarget({ /* another host */ } as unknown);
        assert.equal(invokes, 1);
    });

    test('Loaded EventTrigger added AFTER attach still fires (synchronous catch-up)', () => {
        const v = new TriggerTest();
        // Pre-attach.
        (v as unknown as { SetTarget: (t: unknown) => void })
            .SetTarget({ /* minimal host stub */ } as unknown);

        let invokes = 0;
        const action = new BeginStoryboardAction((target) => {
            invokes++;
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ To: 100, Duration: 50 }));
            return sb;
        });
        v.AddEventTrigger(new EventTrigger('Loaded', [action]));
        assert.equal(invokes, 1, 'late-registered Loaded fires synchronously');
    });
});

// ── Storyboard.TargetName resolution ──────────────────────────────────
// Verified at the compiler emit level (see trigger-actions.test.ts in
// compiler/tests); the runtime side is just `FindName` which has its
// own coverage.

describe('Compatibility: legacy PropertyTrigger 4-arg constructor still works', () => {
    test('Constructor without enter/exit actions defaults to empty arrays', () => {
        const t = new PropertyTrigger(
            Border, 'IsMouseOver', true,
            [new Setter(Border, 'Fill', undefined)],
        );
        assert.deepEqual(t.enterActions, []);
        assert.deepEqual(t.exitActions,  []);
    });
});
