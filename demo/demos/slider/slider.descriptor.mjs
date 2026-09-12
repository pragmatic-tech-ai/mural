// slider demo — SliderVM is empty; the .mu file declares the visual
// structure as a DataTemplate keyed on SliderVM. The factory hands the
// platform a VM instance; the demo's view dictionary is merged
// app-global in platform.mu (§ 27).
import { SliderVM } from './slider-vm.mjs';

let vmInstance;

export default {
    id:       'slider',
    title:    'Slider',
    subtitle: 'Single-thumb range with horizontal + vertical orientation, keyboard nudges, and track-click jump-to-point.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new SliderVM();
        return vmInstance;
    },
};
