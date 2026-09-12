// Bootstrap for the pen-editor demo. Instantiates the VM and returns it
// for the platform to host as DataContext; the demo's view dictionary is
// merged app-global in platform.mu (§ 27).


import { PenEditorDemoVM } from './pen-editor-vm.mjs';

let vmInstance;

export default {
    id:       'pen-editor',
    title:    'Pen editor',
    subtitle: 'Inline PowerPoint-style Pen editor — brush, thickness, dash, cap, join.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new PenEditorDemoVM();
        return vmInstance;
    },
};
