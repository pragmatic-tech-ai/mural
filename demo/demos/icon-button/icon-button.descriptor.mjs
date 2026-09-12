// icon-button demo — two rows showcasing the four M3 IconButton variants
// and the four matching IconButtonToggle variants. Click counts and
// checked states bind back through the VM so the dynamic-binding chain
// is visible in the read-outs at the bottom.
import { IconButtonVM } from './icon-button-vm.mjs';

let vmInstance;

export default {
    id:       'icon-button',
    title:    'IconButton',
    subtitle: 'Four M3 chromes; toggle variants flip Background + glyph ink on IsChecked.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new IconButtonVM();
        return vmInstance;
    },
};
