import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';
import { AnimationManager, ManualClock } from '../../runtime/index.js';
import { RotateTransform } from '../../visual-engine/index.js';
import { Arc } from '../../basic/shapes/arc.js';
import { LoadingIndicator, LoadingIndicatorVariant } from '../notifications/loading-indicator.js';

function walk(v: unknown, name: string): { Name?: string; [k: string]: unknown } | undefined
{
    const node = v as { Name?: string; visualChildren?: readonly unknown[] };
    if (node?.Name === name) return node as { Name?: string };
    for (const c of node?.visualChildren ?? [])
    {
        const r = walk(c, name);
        if (r) return r;
    }
    return undefined;
}

function partFill(li: LoadingIndicator): Arc
{
    const arc = walk(li, 'PART_Fill');
    assert.ok(arc instanceof Arc, 'PART_Fill should be an Arc');
    return arc;
}

describe('LoadingIndicator (§18.9)', () => {

    test('defaults — ActiveIndicator variant, IsActive true', () => {
        initTestApp();
        const li = new LoadingIndicator();
        assert.equal(li.Variant, LoadingIndicatorVariant.ActiveIndicator);
        assert.equal(li.IsActive, true);
    });

    test('template adopts PART_Fill and pivots it with a RotateTransform', () => {
        initTestApp();
        const li = new LoadingIndicator();
        const arc = partFill(li);
        assert.ok(arc.RenderTransform instanceof RotateTransform,
            'PART_Fill carries a RotateTransform for the spin');
        assert.equal(arc.RenderTransformOrigin.X, 0.5);
        assert.equal(arc.RenderTransformOrigin.Y, 0.5);
    });

    test('IsActive true (default) begins the indeterminate animation', () => {
        initTestApp();
        AnimationManager.ResetForTests();
        const li = new LoadingIndicator();
        assert.equal(li.IsAnimating, true, 'spins on construction while active');
    });

    test('clock ticks rotate the arc and oscillate its sweep', () => {
        initTestApp();
        AnimationManager.ResetForTests();
        const clock = AnimationManager.Instance.Clock as ManualClock;
        const li = new LoadingIndicator();
        const arc = partFill(li);
        const rotate = arc.RenderTransform as RotateTransform;

        assert.equal(rotate.Angle, 0, 'starts unrotated');
        clock.Tick(350);   // quarter of the 1400ms rotation
        assert.ok(rotate.Angle > 0, `arc rotated (angle=${rotate.Angle})`);
        // Sweep (EndAngle) has moved off its resting -50 toward the wider arc.
        assert.notEqual(arc.EndAngle, -50, 'sweep amplitude oscillates');
    });

    test('IsActive=false stops the animation; re-enabling restarts it', () => {
        initTestApp();
        AnimationManager.ResetForTests();
        const li = new LoadingIndicator();
        assert.equal(li.IsAnimating, true);

        li.IsActive = false;
        assert.equal(li.IsAnimating, false, 'idle indicator burns no frames');

        li.IsActive = true;
        assert.equal(li.IsAnimating, true, 'restarts when re-activated');
    });

    test('the animation loops forever (never completes)', () => {
        initTestApp();
        AnimationManager.ResetForTests();
        const clock = AnimationManager.Instance.Clock as ManualClock;
        const li = new LoadingIndicator();
        clock.Tick(10_000);   // many rotation periods
        assert.equal(li.IsAnimating, true, 'RepeatBehavior=Infinity keeps it running');
    });
});
