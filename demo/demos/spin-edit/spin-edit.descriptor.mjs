// spin-edit demo — SpinEditVM is empty; the .mu file declares the
// visual structure as a DataTemplate keyed on SpinEditVM. The factory
// hands the platform a VM instance; the demo's view dictionary is
// merged app-global in platform.mu (§ 27).
import { SpinEditVM } from './spin-edit-vm.mjs';

let vmInstance;

export default {
    id:       'spin-edit',
    title:    'SpinEdit',
    subtitle: 'Numeric up/down with clamping, decimal precision, and small/large step keys (Arrow, PageUp/Down).',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new SpinEditVM();
        return vmInstance;
    },
};
