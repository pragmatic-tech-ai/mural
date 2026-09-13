import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';
import { AnimationManager, ManualClock, Size, Rect } from '../../runtime/index.js';
import { TranslateTransform } from '../../visual-engine/index.js';
import { Border } from '../../basic/border.js';
import { ProgressIndicator, ProgressIndicatorVariant } from '../notifications/progress-indicator.js';

function walk(v: unknown, name: string): { Name?: string; [k: string]: unknown } | undefined {
    const node = v as { Name?: string; visualChildren?: readonly unknown[] };
    if (node?.Name === name) return node as { Name?: string };
    for (const c of node?.visualChildren ?? []) {
        const r = walk(c, name);
        if (r) return r;
    }
    return undefined;
}

function partFill(pi: ProgressIndicator): Border {
    const fill = walk(pi, 'PART_Fill');
    assert.ok(fill instanceof Border, 'PART_Fill should be a Border');
    return fill;
}

// Force a layout pass so the control learns its track width (the sweep span).
function layout(pi: ProgressIndicator, width = 200): void {
    pi.Measure(new Size(width, 4));
    pi.Arrange(new Rect(0, 0, width, 4));
}

describe('ProgressIndicator — linear indeterminate animation', () => {

    test('defaults — Linear variant, not indeterminate, not animating', () => {
        initTestApp();
        AnimationManager.ResetForTests();
        const pi = new ProgressIndicator();
        assert.equal(pi.Variant, ProgressIndicatorVariant.Linear);
        assert.equal(pi.IsIndeterminate, false);
        assert.equal(pi.IsAnimating, false, 'a determinate indicator burns no frames');
    });

    test('PART_Fill carries a TranslateTransform for the sweep', () => {
        initTestApp();
        const pi = new ProgressIndicator();
        const fill = partFill(pi);
        assert.ok(fill.RenderTransform instanceof TranslateTransform,
            'PART_Fill carries a TranslateTransform');
    });

    test('setting IsIndeterminate begins the animation', () => {
        initTestApp();
        AnimationManager.ResetForTests();
        const pi = new ProgressIndicator();
        assert.equal(pi.IsAnimating, false);
        pi.IsIndeterminate = true;
        assert.equal(pi.IsAnimating, true, 'the indeterminate sweep runs');
    });

    test('clock ticks translate the fill segment across the track', () => {
        initTestApp();
        AnimationManager.ResetForTests();
        const clock = AnimationManager.Instance.Clock as ManualClock;
        const pi = new ProgressIndicator();
        pi.IsIndeterminate = true;
        layout(pi, 200);
        const fill = partFill(pi);
        const t = fill.RenderTransform as TranslateTransform;

        // Segment starts fully off the left edge (negative X) and moves right.
        assert.ok(t.X < 0, `segment starts off the left edge (X=${t.X})`);
        const before = t.X;
        clock.Tick(400);
        assert.ok(t.X > before, `segment advanced rightward (X ${before} -> ${t.X})`);
    });

    test('IsIndeterminate=false stops the animation; re-enabling restarts it', () => {
        initTestApp();
        AnimationManager.ResetForTests();
        const pi = new ProgressIndicator();
        pi.IsIndeterminate = true;
        assert.equal(pi.IsAnimating, true);

        pi.IsIndeterminate = false;
        assert.equal(pi.IsAnimating, false, 'switching to determinate stops the sweep');

        pi.IsIndeterminate = true;
        assert.equal(pi.IsAnimating, true, 'restarts when indeterminate again');
    });

    test('the sweep loops forever (never completes)', () => {
        initTestApp();
        AnimationManager.ResetForTests();
        const clock = AnimationManager.Instance.Clock as ManualClock;
        const pi = new ProgressIndicator();
        pi.IsIndeterminate = true;
        layout(pi, 200);
        clock.Tick(30_000);   // many sweep periods
        assert.equal(pi.IsAnimating, true, 'RepeatBehavior=Infinity keeps it running');
    });
});
