// toggle-button demo — exposes the ToggleButton control via a simple
// VM-driven demo. The .mu side declares a DataTemplate keyed off the
// ToggleButtonVM type so PageView's ContentControl auto-resolves it.
import { ToggleButtonVM } from './toggle-button-vm.mjs';

let vmInstance;

export default {
    id:       'toggle-button',
    title:    'ToggleButton',
    subtitle: 'IsChecked flips on click; TwoWay binding keeps VM and chrome in sync.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new ToggleButtonVM();
        return vmInstance;
    },
};
