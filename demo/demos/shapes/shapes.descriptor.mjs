// shapes demo — registers the M3 Expressive shape library catalogue
// with the platform shell. Static, no commands, no bindings — the VM
// exists only to satisfy the platform's DataTemplate-keyed-on-DataType
// rendering convention.
import { ShapesVM } from './shapes-vm.mjs';

let vmInstance;

export default {
    id:       'shapes',
    title:    'Expressive shapes',
    subtitle: 'M3 Expressive shape catalogue — all 35 named shapes.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new ShapesVM();
        return vmInstance;
    },
};
