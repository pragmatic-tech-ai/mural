// top-app-bar demo — one row per M3 variant (Small / CenterAligned /
// Medium / Large) with shared IconButton actions and a click-count
// read-out so the dynamic-binding chain is visible end-to-end.
import { TopAppBarVM } from './top-app-bar-vm.mjs';

let vmInstance;

export default {
    id:       'top-app-bar',
    title:    'TopAppBar',
    subtitle: 'Four M3 variants; Variant DP drives row count and title typography.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new TopAppBarVM();
        return vmInstance;
    },
};
