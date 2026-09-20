import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AnimationManager,
    Application,
    DoubleAnimation,
    DynamicResource,
    ManualClock,
    MetaData,
    MuralBase,
    Panel,
    ResourceDictionary,
    Size,
    ThemeManager,
    Element,
    Visual,
    registerSchemeTransitionAnimator,
    _clearAllSchemeTransitionAnimators,
    type DrawingContext,
} from '../index.js';
import { resolveKey } from '../model-internals.js';

// Tiny Visual with one MetaData.None property used as a DynamicResource
// target. Plain Visual doesn't expose anything settable, so we wrap.
class TargetLeaf extends Element
{
    static
    {
        MuralBase.RegisterProperty(TargetLeaf, 'Brush', undefined, MetaData.None);
    }
    public get Brush(): unknown { return this.get_property_value(resolveKey(this, undefined, 'Brush')); }
    public set Brush(v: unknown) { this.set_property_value(resolveKey(this, undefined, 'Brush'), v); }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

describe('ResourceDictionary — local entries + Resolve / CanResolve', () => {
    test('Resolve returns a locally-set entry', () => {
        const d = new ResourceDictionary();
        d.Set('K', 42);
        assert.equal(d.Resolve('K'), 42);
        assert.equal(d.CanResolve('K'), true);
    });

    test('Resolve / CanResolve return undefined / false for missing keys', () => {
        const d = new ResourceDictionary();
        assert.equal(d.Resolve('K'), undefined);
        assert.equal(d.CanResolve('K'), false);
    });

    test('Delete removes the entry; Clear empties everything', () => {
        const d = new ResourceDictionary();
        d.Set('A', 1);
        d.Set('B', 2);
        assert.equal(d.Delete('A'), true);
        assert.equal(d.CanResolve('A'), false);
        assert.equal(d.CanResolve('B'), true);
        d.Clear();
        assert.equal(d.CanResolve('B'), false);
        assert.equal(d.Size, 0);
    });
});

describe('ResourceDictionary — MergedDictionaries', () => {
    test('merged dictionary values become visible through the outer dict', () => {
        const inner = new ResourceDictionary();
        inner.Set('Accent', 'blue');
        const outer = new ResourceDictionary();
        outer.AddMergedDictionary(inner);
        assert.equal(outer.Resolve('Accent'), 'blue');
        assert.equal(outer.CanResolve('Accent'), true);
    });

    test('local entries shadow merged entries with the same key', () => {
        const inner = new ResourceDictionary();
        inner.Set('Accent', 'blue');
        const outer = new ResourceDictionary();
        outer.AddMergedDictionary(inner);
        outer.Set('Accent', 'red');
        assert.equal(outer.Resolve('Accent'), 'red');
    });

    test('last-merged dictionary wins on conflict (WPF semantics)', () => {
        const a = new ResourceDictionary();
        a.Set('Accent', 'from-A');
        const b = new ResourceDictionary();
        b.Set('Accent', 'from-B');
        const outer = new ResourceDictionary();
        outer.AddMergedDictionary(a);
        outer.AddMergedDictionary(b);
        assert.equal(outer.Resolve('Accent'), 'from-B');
    });

    test('RemoveMergedDictionary detaches and stops resolution through it', () => {
        const inner = new ResourceDictionary();
        inner.Set('K', 1);
        const outer = new ResourceDictionary();
        outer.AddMergedDictionary(inner);
        assert.equal(outer.Resolve('K'), 1);

        assert.equal(outer.RemoveMergedDictionary(inner), true);
        assert.equal(outer.Resolve('K'), undefined);
        assert.equal(outer.MergedDictionaries.length, 0);
    });

    test('nested merges resolve transitively', () => {
        const grandchild = new ResourceDictionary();
        grandchild.Set('Deep', 'value');
        const child = new ResourceDictionary();
        child.AddMergedDictionary(grandchild);
        const outer = new ResourceDictionary();
        outer.AddMergedDictionary(child);
        assert.equal(outer.Resolve('Deep'), 'value');
    });

    test('cycles are rejected (direct self-merge AND transitive)', () => {
        const d = new ResourceDictionary();
        assert.throws(() => d.AddMergedDictionary(d), /cannot merge.*into itself/);

        const a = new ResourceDictionary();
        const b = new ResourceDictionary();
        a.AddMergedDictionary(b);
        // b → a would create a → b → a cycle.
        assert.throws(() => b.AddMergedDictionary(a), /create a cycle/);
    });
});

describe('ResourceDictionary — Subscribe / change notifications', () => {
    test('Set fires the listener', () => {
        const d = new ResourceDictionary();
        let count = 0;
        d.Subscribe(() => { count++; });
        d.Set('K', 1);
        assert.equal(count, 1);
        d.Set('K', 2);
        assert.equal(count, 2);
    });

    test('Delete fires only when something was removed', () => {
        const d = new ResourceDictionary();
        d.Set('K', 1);
        let count = 0;
        d.Subscribe(() => { count++; });
        assert.equal(d.Delete('Missing'), false);
        assert.equal(count, 0);
        assert.equal(d.Delete('K'), true);
        assert.equal(count, 1);
    });

    test('Clear fires once when non-empty; no-ops when already empty', () => {
        const d = new ResourceDictionary();
        let count = 0;
        d.Subscribe(() => { count++; });
        d.Clear();
        assert.equal(count, 0);
        d.Set('K', 1);
        d.Clear();
        assert.equal(count, 2);  // Set + Clear
    });

    test('AddMergedDictionary / RemoveMergedDictionary fire the listener', () => {
        const inner = new ResourceDictionary();
        const outer = new ResourceDictionary();
        let count = 0;
        outer.Subscribe(() => { count++; });
        outer.AddMergedDictionary(inner);
        assert.equal(count, 1);
        outer.RemoveMergedDictionary(inner);
        assert.equal(count, 2);
    });

    test('mutating a merged dictionary forwards a notification to the outer dict', () => {
        const inner = new ResourceDictionary();
        const outer = new ResourceDictionary();
        outer.AddMergedDictionary(inner);
        let count = 0;
        outer.Subscribe(() => { count++; });
        // Reset to ignore the AddMergedDictionary fire.
        count = 0;
        inner.Set('K', 1);
        assert.equal(count, 1);
        inner.Delete('K');
        assert.equal(count, 2);
    });

    test('unsubscribe stops further notifications', () => {
        const d = new ResourceDictionary();
        let count = 0;
        const unsub = d.Subscribe(() => { count++; });
        d.Set('A', 1);
        unsub();
        d.Set('B', 2);
        assert.equal(count, 1);
    });

    test('RemoveMergedDictionary detaches the inner dict\'s forwarded notifications', () => {
        const inner = new ResourceDictionary();
        const outer = new ResourceDictionary();
        outer.AddMergedDictionary(inner);
        let count = 0;
        outer.Subscribe(() => { count++; });
        count = 0;  // ignore the AddMergedDictionary fire
        outer.RemoveMergedDictionary(inner);
        count = 0;  // and the RemoveMergedDictionary fire
        inner.Set('Z', 9);
        assert.equal(count, 0);
    });
});

describe('Visual.TryFindResource resolves through MergedDictionaries', () => {
    test('values from a merged dictionary on an ancestor are visible to descendants', () => {
        // The Visual ancestor walk finds a dictionary that CanResolve
        // the key, then Resolve returns the merged value.
        class TestPanel extends Panel { }
        const inner = new ResourceDictionary();
        inner.Set('Theme', 'dark');

        const root = new TestPanel();
        root.Resources.AddMergedDictionary(inner);

        const leaf = new TargetLeaf();
        root.AddChild(leaf);

        assert.equal(leaf.TryFindResource('Theme'), 'dark');
    });
});

describe('DynamicResource', () => {
    test('initial resolution returns the current value from the ancestor chain', () => {
        class TestPanel extends Panel { }
        const root = new TestPanel();
        root.Resources.Set('Brush', 'gold');
        const leaf = new TargetLeaf();
        root.AddChild(leaf);

        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));
        assert.equal(leaf.Brush, 'gold');
    });

    test('updating the resource propagates to the bound target', () => {
        class TestPanel extends Panel { }
        const root = new TestPanel();
        root.Resources.Set('Brush', 'gold');
        const leaf = new TargetLeaf();
        root.AddChild(leaf);

        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));
        assert.equal(leaf.Brush, 'gold');

        root.Resources.Set('Brush', 'silver');
        assert.equal(leaf.Brush, 'silver');
    });

    test('updates through a MergedDictionary propagate', () => {
        class TestPanel extends Panel { }
        const theme = new ResourceDictionary();
        theme.Set('Brush', 'theme-blue');
        const root = new TestPanel();
        root.Resources.AddMergedDictionary(theme);
        const leaf = new TargetLeaf();
        root.AddChild(leaf);

        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));
        assert.equal(leaf.Brush, 'theme-blue');

        theme.Set('Brush', 'theme-red');
        assert.equal(leaf.Brush, 'theme-red');
    });

    test('adding a merging dictionary at runtime re-resolves through it', () => {
        // Tests the change-notification forwarding path: the outer
        // dict's listeners fire on AddMergedDictionary, the
        // DynamicResource re-resolves, and the binding picks up the
        // newly-visible value.
        class TestPanel extends Panel { }
        const root = new TestPanel();
        // root.Resources has nothing yet — DynamicResource still
        // subscribes to it (since the dict exists, even if empty).
        root.Resources;
        const leaf = new TargetLeaf();
        root.AddChild(leaf);

        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));
        assert.equal(leaf.Brush, undefined);

        const theme = new ResourceDictionary();
        theme.Set('Brush', 'merged-in');
        root.Resources.AddMergedDictionary(theme);
        assert.equal(leaf.Brush, 'merged-in');
    });

    test('re-parenting re-wires ancestor subscriptions', () => {
        // After moving a Visual (with a DynamicResource binding) to a
        // new ancestor chain, the binding picks up resources defined
        // on the new ancestors AND stops responding to changes on the
        // old ones. AttachLogical / DetachLogical drive the re-wire
        // via Visual._refresh_dynamic_resources_subtree.
        class TestPanel extends Panel { }
        const oldRoot = new TestPanel();
        const newRoot = new TestPanel();
        oldRoot.Resources.Set('Brush', 'from-old-root');
        newRoot.Resources.Set('Brush', 'from-new-root');

        const leaf = new TargetLeaf();
        oldRoot.AddChild(leaf);
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));
        assert.equal(leaf.Brush, 'from-old-root');

        // Move the leaf to a different ancestor chain.
        oldRoot.RemoveChild(leaf);
        newRoot.AddChild(leaf);
        assert.equal(leaf.Brush, 'from-new-root',
            'binding should re-walk and pick up newRoot value');

        // Changes on the OLD chain no longer propagate.
        oldRoot.Resources.Set('Brush', 'mutated-on-old-root');
        assert.equal(leaf.Brush, 'from-new-root',
            'old-root mutation should be ignored after re-parent');

        // Changes on the NEW chain do.
        newRoot.Resources.Set('Brush', 'mutated-on-new-root');
        assert.equal(leaf.Brush, 'mutated-on-new-root');
    });

    test('re-parenting through an intermediate ancestor cascades to grand-descendants', () => {
        // The fire-on-subtree path: a deep DynamicResource binding
        // doesn't have its own _logicalParent change when an ancestor
        // re-attaches; the recursive propagate_dynamic_resources_to_
        // logical_children walk has to reach down.
        class TestPanel extends Panel { }
        const newRoot = new TestPanel();
        newRoot.Resources.Set('Brush', 'from-new-root');

        const mid  = new TestPanel();
        const leaf = new TargetLeaf();
        mid.AddChild(leaf);

        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));
        assert.equal(leaf.Brush, undefined,
            'no ancestor with the key yet');

        newRoot.AddChild(mid);
        assert.equal(leaf.Brush, 'from-new-root',
            'cascade through mid reaches leaf');
    });

    test('replacing the DynamicResource with a local value disposes subscriptions', () => {
        class TestPanel extends Panel { }
        const root = new TestPanel();
        root.Resources.Set('Brush', 'one');
        const leaf = new TargetLeaf();
        root.AddChild(leaf);

        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), 'manual');
        assert.equal(leaf.Brush, 'manual');

        // After replacement, the old subscription is disposed —
        // mutating the dict no longer updates the target.
        root.Resources.Set('Brush', 'two');
        assert.equal(leaf.Brush, 'manual');
    });

    test('a closer ancestor shadows a farther one and DynamicResource picks the close value', () => {
        class TestPanel extends Panel { }
        const outer = new TestPanel();
        outer.Resources.Set('Brush', 'outer');
        const inner = new TestPanel();
        inner.Resources.Set('Brush', 'inner');
        outer.AddChild(inner);
        const leaf = new TargetLeaf();
        inner.AddChild(leaf);

        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));
        assert.equal(leaf.Brush, 'inner');
    });
});

describe('ResourceDictionary — Root marker (x:root)', () => {
    test('Root is undefined on a fresh dictionary', () => {
        const d = new ResourceDictionary();
        assert.equal(d.Root, undefined);
    });

    test('setting Root then reading it returns the same Visual', () => {
        const d = new ResourceDictionary();
        const v = new TargetLeaf();
        d.Root = v;
        assert.equal(d.Root, v);
    });

    test('re-assigning the same Visual is idempotent', () => {
        const d = new ResourceDictionary();
        const v = new TargetLeaf();
        d.Root = v;
        assert.doesNotThrow(() => { d.Root = v; });
        assert.equal(d.Root, v);
    });

    test('assigning a different Visual over an existing Root throws', () => {
        const d = new ResourceDictionary();
        const a = new TargetLeaf();
        const b = new TargetLeaf();
        d.Root = a;
        assert.throws(() => { d.Root = b; }, /only one x:root per dictionary/);
        // Original root remains.
        assert.equal(d.Root, a);
    });

    test('assigning undefined clears Root and re-assignment is then allowed', () => {
        const d = new ResourceDictionary();
        const a = new TargetLeaf();
        const b = new TargetLeaf();
        d.Root = a;
        d.Root = undefined;
        assert.equal(d.Root, undefined);
        d.Root = b;
        assert.equal(d.Root, b);
    });
});

// Scheme-transition integration. Verifies that DynamicResource consults
// the registered animator factory + ThemeManager.SchemeTransition, and
// drives a Storyboard on its internal watcher when both are present.
// The factory is a stub that produces a DoubleAnimation — the value
// type being animated is irrelevant to the integration; what matters is
// that the watcher's Value is interpolated and the consumer's binding
// observes the intermediate values. The real SolidColorBrush
// integration is covered in visual-engine tests.
describe('DynamicResource — scheme-transition animation', () => {
    class TestPanel extends Panel { }

    function setupClock(): ManualClock
    {
        const clock = new ManualClock();
        AnimationManager.Instance.Clock = clock;
        return clock;
    }

    function reset(): void
    {
        AnimationManager.ResetForTests();
        ThemeManager._resetForTesting();
        Application.current = null;
        // Drop any factory a prior test installed AND the per-type
        // secondaries that `scheme-transition-animators.ts` registers
        // as module side-effects (number / Thickness / CornerRadius).
        // Without clearing the secondaries, "no factory" / "factory
        // returns undefined" tests still hit the leaked number
        // secondary for their number→number value pairs and animate
        // instead of snapping.
        _clearAllSchemeTransitionAnimators();
    }

    function numberAnimatorFactory(
        oldValue: unknown,
        newValue: unknown,
        transition: { duration: number },
    ): DoubleAnimation | undefined
    {
        if (typeof oldValue !== 'number') return undefined;
        if (typeof newValue !== 'number') return undefined;
        return new DoubleAnimation({
            From:     oldValue,
            To:       newValue,
            Duration: transition.duration,
        });
    }

    test('value swap snaps when no transition is configured', () => {
        reset();
        setupClock();
        registerSchemeTransitionAnimator(numberAnimatorFactory);

        const root = new TestPanel();
        root.Resources.Set('Brush', 10);
        const leaf = new TargetLeaf();
        root.AddChild(leaf);
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));

        root.Resources.Set('Brush', 20);
        assert.equal(leaf.Brush, 20, 'no SchemeTransition → snap');
        reset();
    });

    test('value swap snaps when no factory is registered', () => {
        reset();
        setupClock();
        ThemeManager.SchemeTransition = { duration: 100 };

        const root = new TestPanel();
        root.Resources.Set('Brush', 10);
        const leaf = new TargetLeaf();
        root.AddChild(leaf);
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));

        root.Resources.Set('Brush', 20);
        assert.equal(leaf.Brush, 20, 'no factory → snap');
        reset();
    });

    test('value swap snaps when transition.tokens is "none"', () => {
        reset();
        setupClock();
        registerSchemeTransitionAnimator(numberAnimatorFactory);
        ThemeManager.SchemeTransition = { duration: 100, tokens: 'none' };

        const root = new TestPanel();
        root.Resources.Set('Brush', 10);
        const leaf = new TargetLeaf();
        root.AddChild(leaf);
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));

        root.Resources.Set('Brush', 20);
        assert.equal(leaf.Brush, 20, 'tokens=none short-circuits the factory');
        reset();
    });

    test('value swap snaps when factory returns undefined for the pair', () => {
        reset();
        setupClock();
        // Factory returns undefined for everything — exercises the
        // "factory can't animate this pair" path.
        registerSchemeTransitionAnimator(() => undefined);
        ThemeManager.SchemeTransition = { duration: 100 };

        const root = new TestPanel();
        root.Resources.Set('Brush', 10);
        const leaf = new TargetLeaf();
        root.AddChild(leaf);
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));

        root.Resources.Set('Brush', 20);
        assert.equal(leaf.Brush, 20, 'factory returned undefined → snap');
        reset();
    });

    test('initial resolution always snaps (no oldValue to animate from)', () => {
        reset();
        setupClock();
        registerSchemeTransitionAnimator(numberAnimatorFactory);
        ThemeManager.SchemeTransition = { duration: 100 };

        const root = new TestPanel();
        root.Resources.Set('Brush', 7);
        const leaf = new TargetLeaf();
        root.AddChild(leaf);
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));
        assert.equal(leaf.Brush, 7, 'first resolve is a snap regardless of policy');
        reset();
    });

    test('value swap with transition + factory drives the animation through the watcher', () => {
        reset();
        const clock = setupClock();
        registerSchemeTransitionAnimator(numberAnimatorFactory);
        ThemeManager.SchemeTransition = { duration: 100 };

        const root = new TestPanel();
        root.Resources.Set('Brush', 10);
        const leaf = new TargetLeaf();
        root.AddChild(leaf);
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));
        assert.equal(leaf.Brush, 10);

        // Trigger the swap — animation begins at t=0 with animated slot
        // pinned at From=10. Consumer sees the start value, not the
        // post-swap snap.
        root.Resources.Set('Brush', 20);
        assert.equal(leaf.Brush, 10, 'at t=0 the animated slot is From');

        // Mid-animation — linear progress=0.5 → 15.
        clock.Tick(50);
        assert.equal(leaf.Brush, 15, 'mid-animation interpolated value');

        // End of animation — FillBehavior.Stop releases the slot,
        // LocalValue=20 surfaces.
        clock.Tick(50);
        assert.equal(leaf.Brush, 20, 'after animation completes the LocalValue surfaces');
        reset();
    });

    test('back-to-back swaps mid-animation: the prior storyboard is stopped, a new one begins', () => {
        reset();
        const clock = setupClock();
        registerSchemeTransitionAnimator(numberAnimatorFactory);
        ThemeManager.SchemeTransition = { duration: 100 };

        const root = new TestPanel();
        root.Resources.Set('Brush', 0);
        const leaf = new TargetLeaf();
        root.AddChild(leaf);
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));

        root.Resources.Set('Brush', 100);
        clock.Tick(50);
        assert.equal(leaf.Brush, 50, 'first animation halfway');

        // Mid-flight, swap again. The factory's `oldValue` is the
        // CURRENT effective value (mid-animation = 50, not the prior
        // LocalValue 100), so the new animation tweens From=50 To=0 —
        // continuous from where we were.
        root.Resources.Set('Brush', 0);
        assert.equal(leaf.Brush, 50, 'new animation begins continuously from the mid-flight value');

        clock.Tick(50);
        assert.equal(leaf.Brush, 25, 'halfway between 50 and 0');
        clock.Tick(50);
        assert.equal(leaf.Brush, 0, 'final value surfaces');
        reset();
    });

    test('PrefersReducedMotion on the active root gates the transition off', () => {
        reset();
        setupClock();
        registerSchemeTransitionAnimator(numberAnimatorFactory);
        ThemeManager.SchemeTransition = { duration: 100 };

        // ThemeManager reads PrefersReducedMotion from Application.current
        // .Resources.Root — wire up that chain so the gate engages.
        const app  = new Application();
        const root = new TestPanel();
        Application.current = app;
        app.Resources.Root = root;
        ThemeManager.SetPrefersReducedMotion(root, true);

        root.Resources.Set('Brush', 10);
        const leaf = new TargetLeaf();
        root.AddChild(leaf);
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));

        root.Resources.Set('Brush', 20);
        assert.equal(leaf.Brush, 20, 'a11y override snaps');
        assert.equal(AnimationManager.Instance.ActiveCount, 0,
            'no storyboard was registered');
        reset();
    });

    test('replacing the DynamicResource binding stops the in-flight storyboard', () => {
        reset();
        const clock = setupClock();
        registerSchemeTransitionAnimator(numberAnimatorFactory);
        ThemeManager.SchemeTransition = { duration: 100 };

        const root = new TestPanel();
        root.Resources.Set('Brush', 0);
        const leaf = new TargetLeaf();
        root.AddChild(leaf);
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), DynamicResource(leaf, 'Brush'));

        root.Resources.Set('Brush', 100);
        clock.Tick(50);
        assert.equal(leaf.Brush, 50);
        assert.equal(AnimationManager.Instance.ActiveCount, 1);

        // Replace the binding with a direct local write. The previous
        // binding's dispose stops the storyboard.
        leaf.set_property_value(resolveKey(leaf, undefined, 'Brush'), 999);
        assert.equal(AnimationManager.Instance.ActiveCount, 0,
            'disposing the binding cancels the storyboard');
        assert.equal(leaf.Brush, 999);
        reset();
    });
});
