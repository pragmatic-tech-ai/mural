// loading-indicator demo — M3 2024 LoadingIndicator: two variants
// (ActiveIndicator / Contained) sharing an IsActive flag, with a
// Pause/Resume button. Registers the VM factory with the demo shell.
import { LoadingIndicatorVM } from './loading-indicator-vm.mjs';

let vmInstance;

export default {
    id:       'loading-indicator',
    title:    'Loading Indicator',
    subtitle: 'M3 2024 indeterminate spinner — rotating, variable-amplitude arc.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new LoadingIndicatorVM();
        return vmInstance;
    },
};
