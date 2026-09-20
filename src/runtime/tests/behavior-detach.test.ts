import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AttachBehaviorAction,
    Behavior,
    DetachBehaviorAction,
    MetaData,
    MuralBase,
    Panel,
    PropertyTrigger,
    Style,
    Visual,
    type VisualHost,
} from '../index.js';

// Tracks every OnAttached / OnDetached fire so tests can assert order
// and counts. Subclass holds plain mutable fields; behaviors aren't
// required to do this — most real behaviors store nothing externally
// visible.
class TraceBehavior extends Behavior
{
    public attaches: Visual[] = [];
    public detaches: Visual[] = [];

    public override OnAttached(visual: Visual): void
    {
        this.attaches.push(visual);
    }

    public override OnDetached(visual: Visual): void
    {
        this.detaches.push(visual);
    }
}

describe('Visual.AddUnloadedListener — visualParent transition', () => {
    test('fires when visualParent transitions from defined to undefined', () => {
        const parent = new Panel();
        const child  = new Panel();
        let unloadedCount = 0;
        child.AddUnloadedListener(() => { unloadedCount++; });

        parent.AddChild(child);
        assert.equal(unloadedCount, 0, 'no fire on the attach edge');

        parent.RemoveChild(child);
        assert.equal(unloadedCount, 1, 'one fire on the detach edge');
    });

    test('does NOT fire when the visual is constructed without ever being attached', () => {
        const child = new Panel();
        let unloadedCount = 0;
        child.AddUnloadedListener(() => { unloadedCount++; });
        // No attach, no detach.
        assert.equal(unloadedCount, 0);
    });

    test('fires again on the second detach (NOT one-shot)', () => {
        const parent = new Panel();
        const child  = new Panel();
        let unloadedCount = 0;
        child.AddUnloadedListener(() => { unloadedCount++; });

        parent.AddChild(child);
        parent.RemoveChild(child);
        parent.AddChild(child);
        parent.RemoveChild(child);
        assert.equal(unloadedCount, 2);
    });

    test('does NOT cascade — detaching a parent does not fire on its children', () => {
        const grandparent = new Panel();
        const parent      = new Panel();
        const child       = new Panel();
        let childUnloaded = 0;
        let parentUnloaded = 0;
        child.AddUnloadedListener(() => { childUnloaded++; });
        parent.AddUnloadedListener(() => { parentUnloaded++; });

        grandparent.AddChild(parent);
        parent.AddChild(child);

        // Detach the parent from the grandparent. The child's
        // visualParent still points at `parent`, so its listener does
        // NOT fire — per the "fire on any tree detachment" semantics
        // documented for Behaviors v2.
        grandparent.RemoveChild(parent);
        assert.equal(parentUnloaded, 1);
        assert.equal(childUnloaded, 0);
    });

    test('RemoveUnloadedListener silences the listener', () => {
        const parent = new Panel();
        const child  = new Panel();
        let unloadedCount = 0;
        const listener = (): void => { unloadedCount++; };
        child.AddUnloadedListener(listener);

        parent.AddChild(child);
        parent.RemoveChild(child);
        assert.equal(unloadedCount, 1);

        child.RemoveUnloadedListener(listener);
        parent.AddChild(child);
        parent.RemoveChild(child);
        assert.equal(unloadedCount, 1, 'listener was removed before the second detach');
    });
});

describe('Visual.AddBehavior — auto-wires OnDetached via the Unloaded listener', () => {
    test('OnDetached fires when the host is detached from its parent', () => {
        const parent = new Panel();
        const child  = new Panel();
        const b = new TraceBehavior();

        child.AddBehavior(b);
        parent.AddChild(child);
        assert.deepEqual(b.attaches.length, 1);
        assert.deepEqual(b.detaches.length, 0);

        parent.RemoveChild(child);
        assert.deepEqual(b.detaches.length, 1, 'OnDetached fires on detach');
        assert.equal(b.detaches[0], child, 'and receives the host visual');
    });

    test('multiple behaviors on one host each receive OnDetached', () => {
        const parent = new Panel();
        const child  = new Panel();
        const b0 = new TraceBehavior();
        const b1 = new TraceBehavior();
        child.AddBehavior(b0);
        child.AddBehavior(b1);

        parent.AddChild(child);
        parent.RemoveChild(child);
        assert.equal(b0.detaches.length, 1);
        assert.equal(b1.detaches.length, 1);
    });

    test('OnDetached re-fires on a second detach (matches Unloaded re-fire semantics)', () => {
        const parent = new Panel();
        const child  = new Panel();
        const b = new TraceBehavior();
        child.AddBehavior(b);

        parent.AddChild(child);
        parent.RemoveChild(child);
        parent.AddChild(child);
        parent.RemoveChild(child);
        assert.equal(b.detaches.length, 2);
    });

    test('a behavior attached before the host is ever parented does not fire OnDetached on construction', () => {
        const child = new Panel();
        const b = new TraceBehavior();
        child.AddBehavior(b);
        // Never parented, never detached.
        assert.equal(b.attaches.length, 1);
        assert.equal(b.detaches.length, 0);
    });

    test('OnDetached default is a no-op (behaviors that only need OnAttached compile cleanly)', () => {
        // Subclasses that don't override OnDetached use the base
        // no-op. Construct one inline and verify it doesn't throw on
        // detach.
        class AttachOnlyBehavior extends Behavior
        {
            public touched = false;
            public override OnAttached(_v: Visual): void { this.touched = true; }
        }
        const b = new AttachOnlyBehavior();
        const parent = new Panel();
        const child  = new Panel();
        child.AddBehavior(b);
        parent.AddChild(child);
        parent.RemoveChild(child);   // does not throw — base OnDetached is void
        assert.equal(b.touched, true);
    });
});

// Pins backlog 9.2: triggered behavior attach via AttachBehaviorAction /
// DetachBehaviorAction. The actions plug into the existing
// enterActions / exitActions arrays on PropertyTrigger / DataTrigger /
// MultiTrigger; the compiler emits paired actions per `Behaviors { }`
// entry in a trigger body.
describe('Visual.RemoveBehavior', () => {
    test('Removes the behavior, fires OnDetached, and drops the unload listener', () => {
        const v = new Panel();
        const parent = new Panel();
        const b = new TraceBehavior();

        v.AddBehavior(b);
        assert.deepEqual(b.attaches, [v]);
        assert.equal(v.Behaviors.length, 1);

        v.RemoveBehavior(b);
        assert.deepEqual(b.detaches, [v], 'OnDetached fired exactly once on removal');
        assert.equal(v.Behaviors.length, 0);

        // Trigger an unload edge after removal — the unload listener
        // was unsubscribed, so OnDetached must not fire again.
        parent.AddChild(v);
        parent.RemoveChild(v);
        assert.equal(b.detaches.length, 1, 'no second detach on unload after RemoveBehavior');
    });

    test('Removing a behavior that was never attached is a no-op', () => {
        const v = new Panel();
        const b = new TraceBehavior();
        v.RemoveBehavior(b);  // does not throw
        assert.equal(b.detaches.length, 0);
    });

    test('Subsequent unload edges only detach behaviors that are still attached', () => {
        const v = new Panel();
        const parent = new Panel();
        const a = new TraceBehavior();
        const b = new TraceBehavior();
        v.AddBehavior(a);
        v.AddBehavior(b);
        v.RemoveBehavior(a);  // unsubscribes a's unload listener

        parent.AddChild(v);
        parent.RemoveChild(v);
        assert.equal(a.detaches.length, 1, 'a only detached via RemoveBehavior, not unload');
        assert.equal(b.detaches.length, 1, 'b detached via unload');
    });
});

describe('AttachBehaviorAction / DetachBehaviorAction', () => {
    test('Attach creates a fresh Behavior per invocation; Detach tears it back off', () => {
        const created: TraceBehavior[] = [];
        const attach = new AttachBehaviorAction(() => {
            const b = new TraceBehavior();
            created.push(b);
            return b;
        });
        const detach = new DetachBehaviorAction(attach);

        const v = new Panel();
        attach.Invoke(v);
        assert.equal(created.length, 1);
        assert.equal(v.Behaviors.length, 1);
        assert.deepEqual(created[0]!.attaches, [v]);

        detach.Invoke(v);
        assert.equal(v.Behaviors.length, 0);
        assert.deepEqual(created[0]!.detaches, [v]);
    });

    test('Detach with no prior Attach is a no-op', () => {
        const attach = new AttachBehaviorAction(() => new TraceBehavior());
        const detach = new DetachBehaviorAction(attach);
        const v = new Panel();
        detach.Invoke(v);  // does not throw
        assert.equal(v.Behaviors.length, 0);
    });

    test('Re-entering Attach without a Detach drops the prior behavior cleanly', () => {
        const created: TraceBehavior[] = [];
        const attach = new AttachBehaviorAction(() => {
            const b = new TraceBehavior();
            created.push(b);
            return b;
        });
        const v = new Panel();
        attach.Invoke(v);
        attach.Invoke(v);  // re-enter — first behavior gets detached, fresh attached
        assert.equal(created.length, 2);
        assert.equal(v.Behaviors.length, 1, 'only one behavior currently attached');
        // First behavior saw its detach edge.
        assert.deepEqual(created[0]!.detaches, [v]);
        // Second behavior is the live one.
        assert.deepEqual(created[1]!.attaches, [v]);
        assert.equal(created[1]!.detaches.length, 0);
    });

    test('Each target gets an independent behavior via the per-target WeakMap', () => {
        const attach = new AttachBehaviorAction(() => new TraceBehavior());
        const detach = new DetachBehaviorAction(attach);
        const a = new Panel();
        const b = new Panel();
        attach.Invoke(a);
        attach.Invoke(b);
        assert.equal(a.Behaviors.length, 1);
        assert.equal(b.Behaviors.length, 1);
        // Detaching one target doesn't affect the other.
        detach.Invoke(a);
        assert.equal(a.Behaviors.length, 0);
        assert.equal(b.Behaviors.length, 1);
        // The two behaviors are distinct instances.
        assert.notEqual(a.Behaviors[0], b.Behaviors[0]);
    });

    test('end-to-end via PropertyTrigger: enter attaches, exit detaches', () => {
        // A target Visual with a Boolean DP the trigger watches.
        class Widget extends Panel
        {
            static
            {
                MuralBase.RegisterProperty(Widget, 'IsBusy', false, MetaData.None);
            }
            public get IsBusy(): boolean { return this.get_property_value(Widget.IsBusyKey); }
            public set IsBusy(v: boolean) { this.set_property_value(Widget.IsBusyKey, v); }
            public static IsBusyKey = MuralBase.RegisterProperty(Widget, 'IsBusy', false, MetaData.None);
        }

        const attach = new AttachBehaviorAction(() => new TraceBehavior());
        const detach = new DetachBehaviorAction(attach);
        const style  = new Style(Widget, [], undefined, [
            new PropertyTrigger(Widget, 'IsBusy', true, [], [attach], [detach]),
        ]);

        const w = new Widget();
        // Minimal VisualHost so the Visual has a target for style apply.
        const host: VisualHost = {
            OnMeasureInvalidated: () => {},
            OnArrangeInvalidated: () => {},
            OnRenderInvalidated:  () => {},
            DesiredSurfaceWidth:  100,
            DesiredSurfaceHeight: 100,
        };
        w.SetTarget(host);
        w.Style = style;

        assert.equal(w.Behaviors.length, 0, 'no behavior before the trigger fires');

        // Activation edge — Attach runs.
        w.IsBusy = true;
        assert.equal(w.Behaviors.length, 1, 'behavior attached on trigger enter');
        const attached = w.Behaviors[0] as TraceBehavior;
        assert.deepEqual(attached.attaches, [w]);

        // Deactivation edge — Detach runs.
        w.IsBusy = false;
        assert.equal(w.Behaviors.length, 0, 'behavior detached on trigger exit');
        assert.deepEqual(attached.detaches, [w]);

        // Re-activation — a FRESH behavior gets attached.
        w.IsBusy = true;
        assert.equal(w.Behaviors.length, 1);
        const reattached = w.Behaviors[0] as TraceBehavior;
        assert.notEqual(reattached, attached, 'factory produced a new instance on re-entry');
    });
});
