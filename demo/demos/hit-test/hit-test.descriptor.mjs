// hit-test demo bootstrap — registers the VM factory and wires the
// heart-hit behavior after view materialization (the drag-drop /
// color-picker OnViewMounted pattern). The VM is pure state (IsToggled);
// the .mu declares a single Heart shape; this file is the glue.
import { HitTestVM } from './hit-test-vm.mjs';
import { attachHeartHit } from './behaviors/heart-hit-behavior.mjs';

let vmInstance;

function attachBehaviors(view, vm) {
    const heart = view.FindName('heartShape');
    if (!heart) throw new Error('hit-test.mu missing x:name="heartShape"');
    return attachHeartHit(heart, vm);
}

export default {
    id:       'hit-test',
    title:    'Hit test',
    subtitle: 'A single Heart shape — it publishes its own outline as HitTestGeometry; only clicks inside the heart toggle the fill.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new HitTestVM();
        vmInstance.OnViewMounted = (view) => attachBehaviors(view, vmInstance);
        return vmInstance;
    },
};
