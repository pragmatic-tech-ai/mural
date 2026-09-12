// segmented-button demo — M3 SegmentedButton (Single + Multiple
// variants) wired to an ObservableCollection-backed VM.
import { SegmentedButtonVM } from './segmented-button-vm.mjs';

let vmInstance;

export default {
    id:       'segmented-button',
    title:    'SegmentedButton',
    subtitle: 'M3 connected-segment row — Single + Multiple selection variants.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new SegmentedButtonVM();
        return vmInstance;
    },
};
