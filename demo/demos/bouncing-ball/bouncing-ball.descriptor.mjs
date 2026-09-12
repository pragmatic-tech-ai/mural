// Bootstrap for the bouncing-ball demo. Two halves:
//   1. Merge the demo's compiled `.mu.js` resources into the
//      Application's resource dictionary so the platform's
//      DataTemplate lookup can resolve [DataType=BouncingBallVM].
//   2. Subscribe once to the AnimationManager's clock, compute the
//      delta from the previous tick, and call vm.Step(dt).
//
// The clock subscription survives demo deactivation — the VM keeps
// stepping in the background so re-activating the demo shows the ball
// where physics says it should be, not where it was paused. Trivially
// changeable to pause-on-deactivate if needed; the current behaviour
// makes the demo entertaining when you navigate away briefly.

import { AnimationManager } from '@pragmatic-tech-ai/mural/runtime';
import { BouncingBallVM } from './bouncing-ball-vm.mjs';

let vmInstance;
let clockSubscribed = false;

function ensureClockSubscription(vm) {
    if (clockSubscribed) return;
    clockSubscribed = true;
    // First tick has no previous timestamp — capture and bail. From
    // the second tick on, dt is the wall-clock delta supplied by the
    // host's RafClock (or the ManualClock in tests).
    let lastNow;
    AnimationManager.Instance.Clock.Subscribe((now) => {
        if (lastNow === undefined) { lastNow = now; return; }
        const dt = now - lastNow;
        lastNow = now;
        vm.Step(dt);
    });
}

export default {
    id:       'bouncing-ball',
    title:    'Bouncing Ball',
    subtitle: 'A circle in a box, bouncing forever.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new BouncingBallVM();
        ensureClockSubscription(vmInstance);
        return vmInstance;
    },
};
