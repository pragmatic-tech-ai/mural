// button-group demo — M3 ButtonGroup hover-expand row of action
// buttons. Hovered button widens; siblings shrink. PointerLeave
// returns to resting layout. 200ms tween default.
import { ButtonGroupVM } from './button-group-vm.mjs';

let vmInstance;

export default {
    id:       'button-group',
    title:    'ButtonGroup',
    subtitle: 'M3 2024 hover-expand row of action buttons.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new ButtonGroupVM();
        return vmInstance;
    },
};
