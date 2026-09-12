// drawer demo — DrawerVM drives both drawers through bindings.
// The factory hands the platform a VM instance; the demo's view
// dictionary is merged app-global in platform.mu (§ 27). The
// VM's OnViewMounted hook (called once after the DataTemplate is
// applied) wires the Temporary drawer's Closed listener so a scrim
// click reflects OptionsOpen=false back into the VM.
import { DrawerVM } from './drawer-vm.mjs';

let vmInstance;

export default {
    id:       'drawer',
    title:    'Drawer',
    subtitle: 'Persistent rail + Temporary overlay drawer driven from the same VM.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new DrawerVM();
        return vmInstance;
    },
};
