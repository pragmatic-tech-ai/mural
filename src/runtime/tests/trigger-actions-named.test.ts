import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    AnimationManager,
    Application,
    BeginStoryboardAction,
    DoubleAnimation,
    ManualClock,
    MetaData,
    MuralBase,
    PauseStoryboardAction,
    ResumeStoryboardAction,
    Storyboard,
    StoryboardState,
    StopStoryboardAction,
    Element,
    Visual,
} from '../index.js';
import { resolveKey } from '../model-internals.js';

class NamedTest extends Element
{
    static
    {
        MuralBase.RegisterProperty(NamedTest, 'Width', 0, MetaData.None);
    }
    public get Width(): number { return this.get_property_value(resolveKey(this, undefined, 'Width')); }
    public set Width(v: number) { this.set_property_value(resolveKey(this, undefined, 'Width'), v); }
}

function freshClock(): ManualClock
{
    AnimationManager.ResetForTests();
    const c = new ManualClock();
    AnimationManager.Instance.Clock = c;
    return c;
}

// ── BeginStoryboardAction.Name + named registry ───────────────────────

describe('BeginStoryboardAction.Name', () => {
    beforeEach(() => { Application.current = null; });

    test('Invoke registers the storyboard on the target under the action Name', () => {
        const v = new NamedTest();
        freshClock();
        const action = new BeginStoryboardAction((target) => {
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ To: 100, Duration: 100 }));
            return sb;
        }, 'fade');
        action.Invoke(v);

        const sb = v.GetNamedStoryboard('fade');
        assert.notEqual(sb, undefined);
        assert.equal(sb!.State, StoryboardState.Running);
    });

    test('Re-firing with the same Name overwrites the prior registration', () => {
        const v = new NamedTest();
        freshClock();
        const action = new BeginStoryboardAction((target) => {
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ To: 100, Duration: 100 }));
            return sb;
        }, 'fade');
        action.Invoke(v);
        const first = v.GetNamedStoryboard('fade');
        action.Invoke(v);
        const second = v.GetNamedStoryboard('fade');
        assert.notEqual(first, second);
    });

    test('Two Visuals running the same named action keep independent registrations', () => {
        const a = new NamedTest();
        const b = new NamedTest();
        freshClock();
        const action = new BeginStoryboardAction((target) => {
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ To: 100, Duration: 100 }));
            return sb;
        }, 'fade');
        action.Invoke(a);
        action.Invoke(b);
        const sbA = a.GetNamedStoryboard('fade');
        const sbB = b.GetNamedStoryboard('fade');
        assert.notEqual(sbA, undefined);
        assert.notEqual(sbB, undefined);
        assert.notEqual(sbA, sbB);
    });

    test('Anonymous BeginStoryboardAction (no Name) leaves the registry empty', () => {
        const v = new NamedTest();
        freshClock();
        const action = new BeginStoryboardAction((target) => {
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ To: 100, Duration: 100 }));
            return sb;
        });
        action.Invoke(v);
        assert.equal(v.GetNamedStoryboard('fade'), undefined);
    });
});

// ── StopStoryboardAction / PauseStoryboardAction / ResumeStoryboardAction ──

describe('StopStoryboardAction', () => {
    beforeEach(() => { Application.current = null; });

    test('Stop releases the named storyboard\'s animation slots', () => {
        const clock = freshClock();
        const v = new NamedTest();
        v.Width = 10;
        const begin = new BeginStoryboardAction((target) => {
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ From: 0, To: 100, Duration: 1000 }));
            return sb;
        }, 'slide');
        begin.Invoke(v);
        clock.Tick(500);
        assert.equal(v.Width, 50, 'animation halfway through');

        const stop = new StopStoryboardAction('slide');
        stop.Invoke(v);
        assert.equal(v.Width, 10, 'local 10 re-surfaces after Stop');
        assert.equal(v.GetNamedStoryboard('slide')!.State, StoryboardState.Stopped);
    });

    test('Stop with an unknown name is a silent no-op', () => {
        const v = new NamedTest();
        v.Width = 7;
        const stop = new StopStoryboardAction('nonexistent');
        assert.doesNotThrow(() => stop.Invoke(v));
        assert.equal(v.Width, 7);
    });
});

describe('PauseStoryboardAction / ResumeStoryboardAction', () => {
    beforeEach(() => { Application.current = null; });

    test('Pause suspends ticks; the pinned animated value stays visible', () => {
        const clock = freshClock();
        const v = new NamedTest();
        v.Width = 0;
        const begin = new BeginStoryboardAction((target) => {
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ From: 0, To: 100, Duration: 1000 }));
            return sb;
        }, 'slide');
        begin.Invoke(v);
        clock.Tick(300);
        assert.equal(v.Width, 30);

        const pause = new PauseStoryboardAction('slide');
        pause.Invoke(v);
        assert.equal(v.GetNamedStoryboard('slide')!.State, StoryboardState.Paused);

        // Advance the clock — the paused storyboard does NOT progress.
        clock.Tick(500);
        assert.equal(v.Width, 30, 'paused storyboard freezes Width at the pause-time value');
        assert.equal(AnimationManager.Instance.ActiveCount, 0,
            'paused storyboards unregister from the manager');
    });

    test('Resume re-anchors the clock so elapsed picks up where Pause left off', () => {
        const clock = freshClock();
        const v = new NamedTest();
        v.Width = 0;
        const begin = new BeginStoryboardAction((target) => {
            const sb = new Storyboard();
            sb.Add(target, 'Width', new DoubleAnimation({ From: 0, To: 100, Duration: 1000 }));
            return sb;
        }, 'slide');
        begin.Invoke(v);
        clock.Tick(300);
        new PauseStoryboardAction('slide').Invoke(v);
        clock.Tick(500);            // sleep while paused
        new ResumeStoryboardAction('slide').Invoke(v);
        // After Resume, advancing 200ms more should reach elapsed=500 →
        // Width 50.
        clock.Tick(200);
        assert.equal(v.Width, 50);
    });

    test('Pause on a non-Running storyboard is a no-op', () => {
        const v = new NamedTest();
        v.Width = 0;
        // No Begin — direct PauseStoryboardAction on an unknown name.
        const pause = new PauseStoryboardAction('nonexistent');
        assert.doesNotThrow(() => pause.Invoke(v));
    });

    test('Resume on a non-Paused storyboard is a no-op', () => {
        const v = new NamedTest();
        const resume = new ResumeStoryboardAction('nonexistent');
        assert.doesNotThrow(() => resume.Invoke(v));
    });
});
