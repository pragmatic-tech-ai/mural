// navigation-rail demo — four destinations + active-label read-out.
// SelectedDataItem rides two-way to a VM string, so clicking an item
// updates the read-out via the standard property-changed listener.
import { NavigationRailVM }   from './navigation-rail-vm.mjs';

let vmInstance;

export default {
    id:       'navigation-rail',
    title:    'NavigationRail',
    subtitle: 'Vertical destination strip; SelectedDataItem two-way binds to the VM.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new NavigationRailVM();
        return vmInstance;
    },
};
