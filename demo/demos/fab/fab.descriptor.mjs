// fab demo — three icon-only sizes (Small / Default / Large) plus two
// Extended FABs (different label content). Click counts bind through
// the VM so the dynamic-binding chain is visible end-to-end.
import { FabVM } from './fab-vm.mjs';

let vmInstance;

export default {
    id:       'fab',
    title:    'FAB',
    subtitle: 'Three icon-only sizes + Extended; Size DP drives chrome and CornerRadius.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new FabVM();
        return vmInstance;
    },
};
