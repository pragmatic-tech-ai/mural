// context-menu demo — three coloured panels each with an attached
// ContextMenu. Right-click resolves to the nearest ancestor with a
// menu via the auto-installed PointerDown patch on Visual.prototype.
import { ContextMenuVM } from './context-menu-vm.mjs';

let vmInstance;

export default {
    id:       'context-menu',
    title:    'ContextMenu',
    subtitle: 'Right-click any coloured panel — attached ContextMenu DP routes to the nearest ancestor.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new ContextMenuVM();
        return vmInstance;
    },
};
