// animation demo — AnimationVM holds per-row Storyboard references
// and wires the imperative click handlers in OnViewMounted via
// FindName. The factory hands the platform a VM instance; the demo's
// view dictionary is merged app-global in platform.mu (§ 27).
import { AnimationVM } from './animation-vm.mjs';

let vmInstance;

export default {
    id:       'animation',
    title:    'Animation engine',
    subtitle: 'From/To, AutoReverse + Repeat, ThicknessAnimationUsingKeyFrames — driven by AnimationManager on RafClock.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new AnimationVM();
        return vmInstance;
    },
};
