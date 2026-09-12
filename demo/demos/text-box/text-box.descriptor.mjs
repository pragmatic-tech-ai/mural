// text-box demo — TextBoxVM is intentionally empty; the .mu file
// declares the visual structure as a DataTemplate keyed on TextBoxVM.
// The factory hands the platform a VM instance; the demo's view
// dictionary is merged app-global in platform.mu (§ 27). PageView's
// ContentControl auto-resolves the template by data type and slots the
// produced Visual.
import { TextBoxVM } from './text-box-vm.mjs';

let vmInstance;

export default {
    id:       'text-box',
    title:    'TextBox',
    subtitle: 'Single-line + multi-line text editing with selection, navigation, and clipboard (Ctrl+A/C/X/V).',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new TextBoxVM();
        return vmInstance;
    },
};
