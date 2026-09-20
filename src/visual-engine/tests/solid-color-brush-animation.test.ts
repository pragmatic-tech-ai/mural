import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    AnimationManager,
    Application,
    Color,
    DynamicResource,
    ManualClock,
    MetaData,
    MuralBase,
    Panel,
    Size,
    ThemeManager,
    Element,
    Visual,
    type DrawingContext,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { SolidColorBrush } from '../drawing/brush.js';
import { SolidColorBrushAnimation } from '../drawing/solid-color-brush-animation.js';

describe('SolidColorBrushAnimation', () => {
    test('Evaluate at t=0 returns a fresh SolidColorBrush with From colour', () => {
        const a = new SolidColorBrushAnimation({
            From: new Color(255, 0, 0, 255),
            To:   new Color(0, 0, 255, 255),
            Duration: 100,
        });
        const b = a.Evaluate(0, undefined);
        assert.ok(b instanceof SolidColorBrush);
        assert.equal(b.Color.R, 255);
        assert.equal(b.Color.B, 0);
    });

    test('Evaluate at mid interpolates per channel', () => {
        const a = new SolidColorBrushAnimation({
            From: new Color(0, 0, 0, 255),
            To:   new Color(200, 100, 50, 255),
            Duration: 100,
        });
        const b = a.Evaluate(50, undefined);
        assert.equal(b.Color.R, 100);
        assert.equal(b.Color.G, 50);
        assert.equal(b.Color.B, 25);
    });

    test('Evaluate at t=Duration returns the final brush', () => {
        const a = new SolidColorBrushAnimation({
            From: new Color(0, 0, 0),
            To:   new Color(255, 255, 255),
            Duration: 100,
        });
        const b = a.Evaluate(100, undefined);
        assert.equal(b.Color.R, 255);
        assert.equal(b.Color.G, 255);
    });

    test('From=undefined uses the baseValue brush\'s colour as the starting point', () => {
        const a = new SolidColorBrushAnimation({
            To: new Color(0, 0, 255, 255),
            Duration: 100,
        });
        const startBrush = new SolidColorBrush(new Color(255, 0, 0, 255));
        // At t=0, From defaults to the base brush's colour → red.
        const b0 = a.Evaluate(0, startBrush);
        assert.equal(b0.Color.R, 255);
        // At t=50, interpolated half toward To (blue).
        const bMid = a.Evaluate(50, startBrush);
        assert.equal(bMid.Color.R, 127.5);
        assert.equal(bMid.Color.B, 127.5);
    });

    test('Non-SolidColorBrush baseValue falls back to Transparent as From', () => {
        const a = new SolidColorBrushAnimation({
            To: new Color(255, 255, 255, 255),
            Duration: 100,
        });
        // baseValue is undefined — From defaults to Transparent (alpha 0).
        const b = a.Evaluate(0, undefined);
        assert.equal(b.Color.A, 0);
    });

    test('Every Evaluate returns a NEW SolidColorBrush instance (no aliasing)', () => {
        const a = new SolidColorBrushAnimation({
            From: new Color(0, 0, 0),
            To:   new Color(255, 255, 255),
            Duration: 100,
        });
        const b1 = a.Evaluate(50, undefined);
        const b2 = a.Evaluate(50, undefined);
        assert.notEqual(b1, b2, 'each tick must produce a fresh brush');
        // ...but with equal colour values.
        assert.equal(b1.Color.R, b2.Color.R);
    });
});

// End-to-end SchemeTransition wiring. Imports of the
// `solid-color-brush-animation` module register a factory with the
// runtime — DynamicResource consults it whenever ThemeManager has an
// active SchemeTransition. The test creates a Visual with a Brush DP
// bound through DynamicResource, swaps the resource value, and asserts
// that the consumer sees interpolated SolidColorBrushes per clock tick.
describe('SolidColorBrushAnimation — DynamicResource scheme-transition integration', () => {
    class BrushHost extends Element
    {
        static
        {
            MuralBase.RegisterProperty(BrushHost, 'Background', undefined, MetaData.None);
        }
        public get Background(): unknown { return this.get_property_value(resolveKey(this, undefined, 'Background')); }
        public set Background(v: unknown) { this.set_property_value(resolveKey(this, undefined, 'Background'), v); }
        protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
        protected override RenderOverride(_dc: DrawingContext): void { }
    }

    function reset(): void
    {
        AnimationManager.ResetForTests();
        ThemeManager._resetForTesting();
        Application.current = null;
    }

    test('Brush value swap under an active SchemeTransition tweens through interpolated SolidColorBrushes', () => {
        reset();
        const clock = new ManualClock();
        AnimationManager.Instance.Clock = clock;

        // The factory registered at module load picks up this transition.
        ThemeManager.SchemeTransition = { duration: 100 };

        class TestPanel extends Panel { }
        const root = new TestPanel();
        const red  = new SolidColorBrush(new Color(255, 0, 0, 255));
        const blue = new SolidColorBrush(new Color(0,   0, 255, 255));
        root.Resources.Set('Brush', red);

        const host = new BrushHost();
        root.AddChild(host);
        host.set_property_value(resolveKey(host, undefined, 'Background'), DynamicResource(host, 'Brush'));
        assert.ok(host.Background instanceof SolidColorBrush);
        assert.equal((host.Background as SolidColorBrush).Color.R, 255);

        // Swap red → blue. DynamicResource consults the registered
        // factory, which builds a SolidColorBrushAnimation From=red
        // To=blue and Begins a Storyboard on the watcher.
        root.Resources.Set('Brush', blue);

        const start = host.Background as SolidColorBrush;
        assert.ok(start instanceof SolidColorBrush);
        assert.equal(start.Color.R, 255, 'storyboard at t=0 pins From=red');
        assert.equal(start.Color.B, 0);

        clock.Tick(50);
        const mid = host.Background as SolidColorBrush;
        assert.ok(mid instanceof SolidColorBrush);
        assert.equal(mid.Color.R, 127.5, 'mid-animation red channel');
        assert.equal(mid.Color.B, 127.5, 'mid-animation blue channel');

        clock.Tick(50);
        const end = host.Background as SolidColorBrush;
        assert.ok(end instanceof SolidColorBrush);
        // Animation cleared, LocalValue (= blue) surfaces — and it's
        // the exact same instance the resource dictionary holds.
        assert.equal(end, blue, 'after Stop, the LocalValue brush surfaces');
        reset();
    });

    test('Non-SolidColorBrush values fall through to snap (factory returns undefined)', () => {
        reset();
        const clock = new ManualClock();
        AnimationManager.Instance.Clock = clock;
        ThemeManager.SchemeTransition = { duration: 100 };

        class TestPanel extends Panel { }
        const root = new TestPanel();
        root.Resources.Set('Brush', new SolidColorBrush(new Color(255, 0, 0, 255)));

        const host = new BrushHost();
        root.AddChild(host);
        host.set_property_value(resolveKey(host, undefined, 'Background'), DynamicResource(host, 'Brush'));

        // Replace the brush with a plain number — the factory rejects
        // the pair and the binding snaps.
        root.Resources.Set('Brush', 42);
        assert.equal(host.Background, 42);
        assert.equal(AnimationManager.Instance.ActiveCount, 0,
            'no storyboard ran for the mixed-type swap');
        reset();
    });
});
