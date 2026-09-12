import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from './test-app.js';
import { RepeatButton } from '../repeat-button.js';
import type { PointerEventArgs } from '../../runtime/index.js';

// The pointer handlers ignore their args (press tracking rides IsPressed /
// IsMouseOver DPs), so a bare object stands in for the event.
const fakePointer = {} as PointerEventArgs;

// Direct-drive the protected pointer handlers so the timing is tested without
// standing up a full input target — the repeat behaviour is all in these hooks.
interface Handlers
{
    OnPointerDown(a: PointerEventArgs): void;
    OnPointerUp(a: PointerEventArgs): void;
    OnPointerLeave(a: PointerEventArgs): void;
    OnPointerEnter(a: PointerEventArgs): void;
}
const h = (b: RepeatButton): Handlers => b as unknown as Handlers;

describe('RepeatButton — hold-to-repeat', () =>
{
    beforeEach(() => { initTestApp(); mock.timers.enable({ apis: ['setTimeout'] }); });
    afterEach(() => { mock.timers.reset(); });

    test('fires once immediately on press, then the first repeat after the initial delay', () =>
    {
        const b = new RepeatButton();
        let n = 0; b.onRepeat = () => { n++; };

        h(b).OnPointerDown(fakePointer);
        assert.equal(n, 1, 'immediate fire on press');
        mock.timers.tick(399); assert.equal(n, 1, 'nothing before the initial delay elapses');
        mock.timers.tick(1);   assert.equal(n, 2, 'first repeat at the initial delay (400ms)');
    });

    test('accelerates — repeat gaps shrink while the button stays held', () =>
    {
        const b = new RepeatButton();
        let n = 0; b.onRepeat = () => { n++; };

        h(b).OnPointerDown(fakePointer);   // n=1 (immediate)
        mock.timers.tick(400);             // n=2 (initial delay)
        mock.timers.tick(120);             // n=3 (first accelerated gap)
        mock.timers.tick(100);             // n=4
        assert.equal(n, 4);
        // The gap is now < the first accelerated gap — a 80ms tick advances it.
        mock.timers.tick(80);  assert.equal(n, 5, 'gap shrank below 120ms');
    });

    test('release stops repeating and does NOT fire a click', () =>
    {
        const b = new RepeatButton();
        let n = 0; b.onRepeat = () => { n++; };
        let clicks = 0; b.onClick = () => { clicks++; };

        h(b).OnPointerDown(fakePointer);   // n=1
        mock.timers.tick(400);             // n=2
        h(b).OnPointerUp(fakePointer);
        mock.timers.tick(5000);
        assert.equal(n, 2, 'no repeats after release');
        assert.equal(clicks, 0, 'a held repeat is not a click — onClick never fires');
    });

    test('pointer leave pauses the repeat; re-enter (still held) resumes it', () =>
    {
        const b = new RepeatButton();
        let n = 0; b.onRepeat = () => { n++; };

        h(b).OnPointerDown(fakePointer);   // n=1, press originates here
        mock.timers.tick(400);             // n=2
        h(b).OnPointerLeave(fakePointer);  // pause
        mock.timers.tick(5000); assert.equal(n, 2, 'paused while pointer is off the button');
        h(b).OnPointerEnter(fakePointer);  // still held → resumes
        assert.equal(n, 3, 'resume fires immediately on re-enter');
        mock.timers.tick(400); assert.equal(n, 4, 'and continues repeating');
    });
});
